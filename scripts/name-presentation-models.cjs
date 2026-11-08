'use strict';
const { selectManagerModels } = require('./name-ui-models.cjs');
const { renameBindings, writeNamingPass } = require('./runtime-renaming.cjs');
function namePresentationModels(source) { return renameBindings(source, ast => selectManagerModels(ast, [
  ['gameLighting', 'GameLighting', ['setTargetSetting', 'applyToGlobalLights', 'setShadowsEnabled', 'drawShadowMap']],
  ['gameSoundManager', 'GameSoundManager', ['setListenerWorldLocation', 'playSoundOnSource', 'attachSource', 'destroy']],
  ['effectFactory', 'EffectFactory', ['createVisualEffectInstance', 'createEffectInstance', 'playPersistentEffect', 'stopPersistentEffect']]
])); }
if (require.main === module) writeNamingPass('presentation-model-role-names', namePresentationModels);
module.exports = { namePresentationModels };
