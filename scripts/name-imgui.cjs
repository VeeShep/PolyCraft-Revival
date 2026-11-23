'use strict';
const { selectManagerModels } = require('./name-ui-models.cjs');
const { renameBindings, writeNamingPass } = require('./runtime-renaming.cjs');
function selectImmediateModeGui(ast) { return selectManagerModels(ast, [
  ['imgui', 'ImmediateModeGui', ['isHot', 'isActive', 'mouseWentDown', 'mouseWentUp', 'doButton', 'doButtonFromGuiArchetype', 'clearValidation', 'hasCapturedInput']]
]); }
function nameImmediateModeGui(source) { return renameBindings(source, selectImmediateModeGui); }
if (require.main === module) writeNamingPass('immediate-mode-gui-role-name', nameImmediateModeGui);
module.exports = { nameImmediateModeGui, selectImmediateModeGui };
