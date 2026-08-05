import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
// Explicit .ts extension: tsconfig.node.json uses nodenext resolution.
import { aiPlugin } from './server/aiPlugin.ts'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // The third argument is the env prefix. Passing '' loads variables WITHOUT a
  // `VITE_` prefix, which is exactly what we want: `ANTHROPIC_API_KEY` stays
  // server-side. Naming it `VITE_ANTHROPIC_API_KEY` would inline the secret
  // into the browser bundle and ship it to every visitor.
  //
  // This value is handed to the dev-server middleware only — it is never put in
  // `define`, so it cannot reach client code.
  const env = loadEnv(mode, process.cwd(), '')

  const pick = (name: string) => env[name] || process.env[name]

  return {
    plugins: [
      react(),
      tailwindcss(),
      aiPlugin(
        pick('ANTHROPIC_API_KEY'),
        // Blueprint detection tries these OpenRouter keys in turn; a second key
        // covers the free model's per-account rate limit. Add more here to widen
        // the budget further.
        [pick('OPENROUTER_API_KEY'), pick('OPENROUTER_API_KEY_2')].filter(
          (k): k is string => Boolean(k),
        ),
      ),
    ],
  }
})
