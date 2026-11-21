'use strict';
const { selectManagerModels } = require('./name-ui-models.cjs');
const { renameBindings, writeNamingPass } = require('./runtime-renaming.cjs');
function selectGameMonitor(ast) { return selectManagerModels(ast, [
  ['gameMonitor', 'GameMonitor', ['start', 'stop', 'reset', 'getSampleIndex', 'getAverage', 'getAverageGathered', 'getAverageDeposited', 'onInteractWithResourceDispenser', 'onResourceDeposited']]
]); }
function nameGameMonitor(source) { return renameBindings(source, selectGameMonitor); }
if (require.main === module) writeNamingPass('game-monitor-role-name', nameGameMonitor);
module.exports = { nameGameMonitor, selectGameMonitor };
