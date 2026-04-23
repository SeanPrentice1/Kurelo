export default async function handler(req, res) {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    return res.json({ configured: false })
  }

  res.setHeader('Cache-Control', 'no-store')

  const headers = {
    Authorization: `Bearer ${key}`,
  }

  const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60

  try {
    const [subsRes, recentChargesRes, chargesRes] = await Promise.all([
      fetch('https://api.stripe.com/v1/subscriptions?status=active&limit=100', { headers }),
      fetch(`https://api.stripe.com/v1/charges?created%5Bgte%5D=${thirtyDaysAgo}&limit=100`, { headers }),
      fetch('https://api.stripe.com/v1/charges?limit=8', { headers }),
    ])

    const [subs, recentChargesData, latestCharges] = await Promise.all([
      subsRes.json(),
      recentChargesRes.json(),
      chargesRes.json(),
    ])

    // MRR: normalise every active subscription to a monthly amount
    const mrr = (subs.data || []).reduce((sum, sub) => {
      const item = sub.items?.data?.[0]
      const price = item?.price || sub.plan
      if (!price) return sum

      const amount = price.unit_amount || 0
      const quantity = item?.quantity || sub.quantity || 1
      const interval = price.recurring?.interval || price.interval || 'month'
      const count = price.recurring?.interval_count || price.interval_count || 1

      if (interval === 'month') return sum + (amount * quantity) / count
      if (interval === 'year') return sum + (amount * quantity) / count / 12
      if (interval === 'week') return sum + ((amount * quantity) / count) * 4.33
      return sum
    }, 0)

    // 30-day revenue: sum successful, non-refunded charges
    const revenue30d = (recentChargesData.data || [])
      .filter(c => c.paid && !c.refunded)
      .reduce((sum, c) => sum + c.amount, 0)

    // New subscriptions in the last 30 days
    const newSubs30d = (subs.data || []).filter(s => s.created >= thirtyDaysAgo).length

    const recentCharges = (latestCharges.data || []).slice(0, 6).map(c => ({
      id: c.id,
      amount: c.amount,
      currency: c.currency.toUpperCase(),
      status: c.status,
      description: c.description || c.billing_details?.name || 'Charge',
      created: c.created,
    }))

    res.json({
      configured: true,
      mrr: mrr / 100,
      revenue30d: revenue30d / 100,
      activeSubscriptions: (subs.data || []).length,
      newSubscriptions30d: newSubs30d,
      recentCharges,
    })
  } catch (err) {
    res.status(500).json({ configured: true, error: err.message })
  }
}
