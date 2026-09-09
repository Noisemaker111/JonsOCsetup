import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
/** Inventory from the selected immutable source and actual process load receipts. */
export function extensionInventory(root) {
  const set = JSON.parse(readFileSync(join(root, 'plugin-set.json'), 'utf8'))
  const receipt = process.env.OPENCODE_RUNTIME_RECEIPT
  const loads = receipt && existsSync(receipt) ? readFileSync(receipt, 'utf8').trim().split('\n').filter(Boolean).flatMap(x => { try { return [JSON.parse(x)] } catch { return [] } }) : []
  const packages = set.packages.map(path => {
    const manifest = JSON.parse(readFileSync(join(root, path), 'utf8'))
    const owner = set.entrypointOwners[manifest.server] ?? set.entrypointOwners[manifest.tui]
    return { name: manifest.name, description: manifest.description, directory: path.split('/')[0],
      server: set.serverEntrypoints.some(entry => owner && set.entrypointOwners[entry] === owner),
      tui: set.tuiEntrypoints.includes(manifest.tui),
      loaded: loads.some(row => row.root.replaceAll('\\','/').toLowerCase() === root.replaceAll('\\','/').toLowerCase() && row.component === `server:${owner}`) }
  })
  return { channel: process.env.OPENCODE_RELEASE_CHANNEL ?? 'stable', generation: process.env.OPENCODE_PLUGIN_GENERATION ?? 'unmanaged', packages }
}
export function extensionInventoryText(root) {
  const inventory = extensionInventory(root)
  return `${inventory.channel.toUpperCase()} · ${inventory.generation}\n\n` + inventory.packages.map(p =>
    `${p.name} · ${p.loaded ? 'server loaded' : p.server ? 'server configured (no receipt)' : 'library'}${p.tui ? ' + UI' : ''}\n${p.description}\nSource: ${p.directory}/`
  ).join('\n\n') + '\n\n/plugins lists UI registrations. Pacing belongs to Usage; Quest Giver and dispatch belong to Quests. Project routing is a separate package.'
}
