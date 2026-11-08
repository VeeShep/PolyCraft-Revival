# Runtime readability checkpoint

The complete running `game.canvas.js` is formatted. No engine replacement, gameplay rewrite or execution-order change was introduced.

The immutable original Beta 1 bundle and hash manifest are in `reference/beta-1`. The baseline was extracted from the verified shipped Apple Silicon app and matched the working source byte for byte before transformation. The original Beta 1 save reader is preserved alongside it to test that old apps reject migrated saves. These files are read-only references, excluded by the packaging whitelist.

`scripts/make-runtime-readable.cjs` performed the one-time transformation with Babel parser, traversal and generator. It renamed 88 component bindings using their literal `entityComponentName` and 19 state constructors using their literal prototype `name`. Scope-aware renaming preserves shadowed locals and property names. `scripts/runtime-names.json` records each original binding, byte offset, verified name, evidence and hashes. The script refuses to overwrite subsequent runtime changes. Its syntax-tree round-trip check passed. Existing tests now locate definitions structurally and exercise behavior instead of matching minified text slices.

## Current native lighting/audio/effects role names — Beta 91

Three more private constructors have descriptive names verified from fields on the actual newly created GameManager:

| Previous binding | Role name | Manager field | Bound references |
| --- | --- | --- | --- |
| `Hb` | `GameLighting` | `gameLighting` | 11 |
| `O` | `GameSoundManager` | `gameSoundManager` | 137 |
| `X` | `EffectFactory` | `effectFactory` | 96 |

These are verified descriptive role names, not recovered original spellings. No lighting, shadow, audio or effect implementation changes. Public manager fields, sound/effect archetypes, asset paths, save/network keys and execution order remain unchanged.

`scripts/name-presentation-models.cjs` reuses the existing UI pass's guarded manager-field selector. That selector now accepts the two passes' explicit role lists; the earlier UI pass retains its original roles and evidence. Each field must belong to the actual manager being constructed and call one private factory whose construction resolves to the same binding. Required native methods distinguish lighting, sound and effects. The existing shared rename helper rejects dynamic scope, reassignment, ambiguity, name capture and unsupported shorthand. The CLI appends input/output hashes and evidence while retaining earlier manifest records and checking the immutable Beta 1 bundle.

The canonical inverse proof passes. An independent token comparison reverses exactly **247 identifier edits** back to the previous source bytes, including comments and formatting. Focused checks retain fixture behavior, public keys/asset strings, shadowed locals, rejection cases, CLI provenance/repeat protection and the prior UI pass. The full suite and package results belong in RESTORATION_STATUS.md. No game window was opened; native gameplay and broader original feedback acceptance remain open. Many other aliases and local names are still unresolved.

## Historical native camera/event/UI role names — Beta 75

Four more private constructors have descriptive names verified from fields on the actual newly created GameManager:

| Previous binding | Role name | Manager field | Bound references |
| --- | --- | --- | --- |
| `td` | `GameCamera` | `gameCamera` | 6 |
| `yf` | `GameEventManager` | `eventManager` | 4 |
| `zf` | `GuiManager` | `guiManager` | 4 |
| `Af` | `GameScoresUI` | `gameScoresUI` | 4 |

These are descriptive role names, not recovered original spellings. GameCamera is the native gameplay camera controller; the earlier verified Camera name identifies the separate Turbulenz engine camera. Public manager fields, event strings, GUI artwork/IDs, entity/save keys and implementation order remain unchanged.

`scripts/name-ui-models.cjs` reuses the world-model evidence to find the actual manager factory. Each selected field must belong to its newly constructed manager, use one bound native factory and resolve to a private constructor with the expected native methods. Each factory must construct that same binding once. Duplicate/missing roles, wrong owners/factories, missing methods, shadowed construction, reassignment and capture refuse transformation. The shared scope-aware inverse proof restores the canonical input, and an independent token audit reverses exactly **22 identifier edits** to the prior source bytes, including comments and formatting. Earlier manifest passes and immutable Beta 1 bytes are preserved.

Six focused checks pass before transformation: fixture behavior/shadows/public keys, rejection cases, CLI provenance/repeat protection, and actual native event forwarding/reset, layered GUI queue/frame preservation and camera vector/FOV/mode priorities. Full checks and release evidence are recorded in RESTORATION_STATUS.md. No GUI was launched or engine implementation replaced; native gameplay acceptance remains open.

## Historical world-factory role names — Beta 72

The factory/product pipeline now has four descriptive private names:

| Previous binding | Role name | Bound references |
| --- | --- | --- |
| `e` | `EntityFactory` | 3,316 |
| `M` | `BlockFactory` | 132 |
| `lb` | `GameEntity` | 17 |
| `tf` | `GameBlock` | 4 |

These names describe verified local roles, not claimed lost-original spellings. In particular, thousands of archetype definitions now read `EntityFactory.archetypes` rather than `e.archetypes`, while their public keys and values remain intact.

`scripts/name-world-factories.cjs` reuses the verified world-model selector to locate the created manager. It checks that the two factory fields belong to that actual newly constructed manager, then follows the sole product `.create` call in each native creation method. All four classes must have their required native methods and a construction resolving to the same binding. Missing/duplicate fields, mismatched products, shadowed construction, reassignment and capture are rejected. The shared inverse rename restores the exact canonical Beta 71 input; only four declarations and 3,469 bound references change. Earlier hashes and immutable baseline bytes remain historical and unchanged.

Checks cover component/save-data preservation, block add/remove behavior, shadow/public keys, CLI provenance/repeat guards and the actual native entity/block factory methods. Those native checks preserve name/family/location/rotation/save-flag forwarding, null component defaults, the mandatory grid component and block defaults. The prior world-model fixture is shared without changing its contents. HUD/totem fixtures now resolve the entity-factory namespace from its native factory field rather than the old `e` spelling. All 491 full checks pass after that fixture update; an independent token audit reverses all 3,473 identifier edits back to exact prior source bytes, including comments and formatting. No factory implementation, archetype/component/save/asset identifier, progression or execution order is replaced. Full-game and native-platform acceptance remain separate and open.

## Historical world-model role names — Beta 69

Four private bindings now have descriptive names tied to the native island/save/simulation code: `Ib` → `GameManager` (11 references), `da` → `GameSpace` (71), `Df` → `GameClock` (4) and `ua` → `LevelPersistence` (53). These are verified role names, **not a claim to have recovered their lost original spelling**. Their manifest entries have `descriptive: true`.

`scripts/name-world-models.cjs` follows the stable factory assigned to `this.globals.gameManager`, the unique factory owner called with the `GameSpace` label, and the clock factory assigned to the created manager. Each constructor requires its native methods and an actual construction resolving to that same binding, preventing a shadowed factory from supplying false evidence. The manager's `saveLevel` must call the same validated Parse/Serialize/SaveLoad namespace for serialization and the original user-data save. Missing, duplicate, conflicting or reassigned roles are rejected by the selector/shared renaming helper.

Only declarations/bound references change. The helper's inverse rename restores the canonical committed Beta 68 syntax tree; initial formatting, earlier pass records, immutable baselines, public properties and save/asset keys stay intact. No game state, serializer filtering, timing algorithm or engine implementation is replaced. Tests exercise role naming, shadow/collision guards, factory ownership, original keys/typed vectors, pause/resume behavior, CLI provenance/baseline/repeat protection, and the actual runtime's player-versus-level serialization filters, geometry and script ownership. The actual serializer check passes before and after the transformation. Full-game and native-platform acceptance remain separate and open.

## Historical upstream naming pass — Beta 66

The private `Fa` binding and its 34 references are now `Camera`, verified against the pinned [Turbulenz Camera source at 2cd2857](https://github.com/turbulenz/webgl_benchmark/blob/2cd2857c3f5f00d1d0f31bcb1577f905eee4c068/jslib/camera.js). The read-only reference is `reference/turbulenz-2cd2857/camera.js`, SHA-256 `b035fbda8c1a87e88fe7225d07321e5082b6c670a9967776f26b8a7412d6d7b8`, covered by the existing complete reference license and excluded from packages. It contains additional upstream CameraController code for context; that class is not substituted or renamed.

`scripts/name-camera.cjs` requires a unique constructor with all 14 core prototype methods, an exact canonical `updateFrustumPlanes` body, and an identical `create` factory after normalizing only its math-device parameter, instance local and constructor reference. Other bodies and the game's extra camera methods are not claimed identical to upstream. This pass changes only the constructor binding and its references through the existing scope-aware helper. Public names, projection math, game extensions, asset/save keys, formatting and execution order remain intact. Reversing the rename reproduces the canonical Beta 65 syntax tree; provenance and hashes append to the naming manifest without rewriting earlier evidence.

Checks cover perspective/parallel/infinite projection, factory/frustum behavior, extensions and shadowed names on the isolated reference fixture, plus rejection of mismatched factories/bodies, missing/duplicate methods, ambiguity and capture. Existing native camera and other runtime tests continue to exercise the actual game bundle. These automated checks do not establish graphical or native-platform gameplay acceptance. Do not rerun this completed naming pass against current source.

## Historical upstream naming pass — Beta 55

`SceneNode` is recovered from the readable [Turbulenz benchmark source at 2cd2857](https://github.com/turbulenz/webgl_benchmark/blob/2cd2857c3f5f00d1d0f31bcb1577f905eee4c068/jslib/scenenode.js). The pinned file and complete repository license are in `reference/turbulenz-2cd2857`; its source SHA-256 is `97e95c83a47a44ef70f25e647819f5256e10c93f234766e7861257df60df8100`. The game has one constructor with the same 57 prototype method names. Seven bodies match exactly after canonical parsing/generation: getName, getParent, getDisabled, childNeedsUpdate, getCustomLocalExtents, getCustomWorldExtents and hasLightInstances. This identifies the class; it does not establish that every implementation detail or engine version matches upstream. The camera implementation differs and was left untouched in that pass; Beta 66 later recovers its class name without replacing its implementation.

`scripts/name-scene-node.cjs` checks the pinned hash, unique complete method inventory and seven unchanged bodies before renaming the private `ga` binding and its 71 references. The shared scope-aware helper proves that reversing the name reproduces the canonical committed Beta 54 input. Public properties, save/asset keys, formatting and execution order remain intact. The manifest appends provenance and both hashes; earlier checkpoints remain historical. No upstream engine code is substituted into the running bundle. The read-only reference source stays outside packages, while `desktop/TURBULENZ_REFERENCE_LICENSE.txt` carries the complete license in app packages.

The Beta 52 pass names the three original play states from their literal labels/factory registrations. Beta 53 names the player-data, quest-task and campaign-score models from their factory roles; those three names are explicitly descriptive. Their selectors and the input-controller pass share `scripts/runtime-renaming.cjs`, which refuses dynamic eval/with scope, public bindings, reassignment, ambiguity, capture/collisions, unsupported shorthand, changed baseline and repeat application. Do not rerun completed passes against current source. Current checks, package evidence and remaining native acceptance are in RESTORATION_STATUS.md.

## Historical input-controller role names — Beta 32

The private `oa` binding is now `GameInputController`, based on the game manager's `gameController` factory assignment. The private `Yd` binding is now `HeroControllerAction`, based on its shared `controllerActionA` and `controllerActionB` factories. These are descriptive role names supported by local definitions, not a claim to have recovered their lost original names. Their 64 and 6 references were renamed within the corresponding bindings; public properties, save keys, asset strings, execution order and surrounding formatting were preserved.

`scripts/name-input-controllers.cjs` selects bindings from those public factory roles, applies only their declaration/reference spans and checks the result against Babel's scoped rename. It reverses both names and proves canonical syntax-tree equivalence to the exact pre-pass Beta 31 bundle. It checks the immutable baseline and refuses ambiguous/reassigned constructors, name capture/collisions and repeat application. `scripts/runtime-names.json` retains its original records and hashes and appends this pass's input/output hashes, evidence and `descriptive: true` labels. The initial formatted hash and the Beta 32 naming-pass output hash remain historical evidence, not current-bundle checksums. Later gameplay patches, including the Beta 33 native gesture hook, legitimately change the running bundle; do not rewrite the recorded pass hashes.

At Beta 32, all 316 checks passed, including isolated shadow/public-key/asset behavior and the command's baseline/repeat guards, plus the existing original-runtime behavior checks. The final ARM64 ZIP matches the pass hash and passes architecture/signature checks. Native gameplay acceptance remains open; syntax equivalence and mocked/native-method checks do not replace it.

This is partial semantic recovery, not a claim to have recovered lost original source. Short local variable names, many core constructor aliases, packed expressions and library internals remain unresolved. Do not invent original names. Recover more only with local definition evidence or a verified matching upstream implementation. Save and asset keys, public properties and embedded strings stay unchanged. Syntax-tree equivalence does not replace actual gameplay acceptance.

Save/network boundaries have since been isolated for authoritative co-op; current implementation and remaining acceptance are in RESTORATION_STATUS.md. Continue verifying roles before further renaming and audit serializer behavior before changing it. Do not split the entire engine or replace it with a newer upstream version.

References: [Turbulenz benchmark](https://github.com/turbulenz/webgl_benchmark), [license](https://github.com/turbulenz/webgl_benchmark/blob/master/LICENSE), [Turbulenz engine](https://github.com/turbulenz/turbulenz_engine). The benchmark contains readable engine/capture references, not the complete game source. No upstream code was copied in the initial transformation; existing bundle notices remain intact. Beta 55 adds a licensed read-only reference for naming, without replacing runtime implementations. Retain applicable notices and attribution when copying matching code later.

Subsequent multiplayer work: the initial formatted hash is historical evidence for the one-time formatting pass. The running bundle now deliberately adds two desktop session tick hooks and extracts `beginWorldUpdate` / `updateSimulation`, preserving the solo sequence and enabling non-pausing host menus. It is expected to differ from that initial formatted hash. The immutable Beta 1 baseline and initial name-evidence records remain unchanged; subsequent naming evidence is appended to the manifest. Current behavior and acceptance are tracked in RESTORATION_STATUS.md.
