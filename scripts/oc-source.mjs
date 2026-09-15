/** Read or set which code plain `oc` runs. `oc --default branch|gated` is the only writer. */
import {readDefaultSource, writeDefaultSource, DEFAULT_BRANCH} from './channel-prepare.mjs'
const [action, value] = process.argv.slice(2)
if (action === 'set') {
  const source = writeDefaultSource(value)
  console.log(source === 'gated'
    ? 'oc now opens the release that passed the acceptance gate. `oc --branch` runs the latest merged code for one launch.'
    : `oc now opens the latest merged ${DEFAULT_BRANCH} code. \`oc --gated\` runs the release that passed the acceptance gate for one launch.`)
} else if (!action) console.log(readDefaultSource())
else throw Error('Use: oc-source.mjs [set <branch|gated>]')
