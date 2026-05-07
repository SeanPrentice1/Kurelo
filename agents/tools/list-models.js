#!/usr/bin/env node
// Run: NANO_BANANA_API_KEY=your_key node agents/tools/list-models.js
import 'dotenv/config'

const key = process.env.NANO_BANANA_API_KEY
if (!key) { console.error('NANO_BANANA_API_KEY not set'); process.exit(1) }

const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`)
const data = await res.json()

if (!res.ok) { console.error('Error:', JSON.stringify(data, null, 2)); process.exit(1) }

const imageModels = data.models?.filter(m =>
  m.name.toLowerCase().includes('imagen') ||
  m.name.toLowerCase().includes('image') ||
  m.supportedGenerationMethods?.includes('predict')
)

console.log('\n--- All models ---')
for (const m of data.models ?? []) {
  console.log(`${m.name}  [${(m.supportedGenerationMethods ?? []).join(', ')}]`)
}

console.log('\n--- Imagen / image-generation candidates ---')
for (const m of imageModels ?? []) {
  console.log(`${m.name}  [${(m.supportedGenerationMethods ?? []).join(', ')}]`)
}
