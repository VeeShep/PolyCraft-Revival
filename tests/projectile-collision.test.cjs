'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const runtime = require('./runtime-ast.cjs');
function math() {
  const A = { scratchpad: {},
    v3BuildZero: () => [0, 0, 0], v3Copy: a => [...a],
    v3Sub: (a, b) => a.map((value, index) => value - b[index]),
    v3Add: (a, b) => a.map((value, index) => value + b[index]),
    v3ScalarMul: (a, b) => a.map(value => value * b),
    v3AddScalarMul(a, b, scale, out = []) { a.forEach((value, index) => { out[index] = value + b[index] * scale; }); return out; },
    v3Dot: (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0),
    v3Length: a => Math.hypot(...a), v3LengthSq: a => a.reduce((sum, value) => sum + value * value, 0),
    v3Distance: (a, b) => Math.hypot(...a.map((value, index) => value - b[index])),
    v3DistanceSq: (a, b) => a.reduce((sum, value, index) => sum + (value - b[index]) ** 2, 0),
    v3Normalize(a, out = []) { const length = Math.hypot(...a); a.forEach((value, index) => { out[index] = length ? value / length : 0; }); return out; },
    clamp: (value, low, high) => Math.max(low, Math.min(high, value)), aabbBuild: (...values) => values.slice(0, 6)
  };
  for (const name of ['getNearestPointOnLineToPoint', 'getDistanceBetweenSegmentsSq', 'getLineIntersectSphere', 'getLineIntersectCapsule', 'getLineIntersectSphereOrCapsule']) A[name] = runtime.staticMethod('A', name, { A });
  return A;
}
test('sphere sweeps report entry distance along the segment, including direct hits, tangents, inside starts and misses', () => {
  const A = math(), hit = (...args) => A.getLineIntersectSphere(...args);
  assert.equal(hit([0, 0, 0], [10, 0, 0], [5, 0, 0], 1), 4);
  assert.equal(hit([0, 0, 0], [10, 0, 0], [5, 1, 0], 1), 5);
  assert.equal(hit([5, 0, 0], [10, 0, 0], [5, 0, 0], 1), 0);
  assert.equal(hit([5, 0, 0], [5, 0, 0], [5, 0, 0], 1), 0);
  for (const [start, end, center] of [[[0, 0, 0], [2, 0, 0], [5, 0, 0]], [[0, 0, 0], [10, 0, 0], [-5, 0, 0]], [[0, 0, 0], [10, 0, 0], [5, 2, 0]], [[0, 0, 0], [0, 0, 0], [5, 0, 0]]]) assert.equal(hit(start, end, center, 1), undefined);
});
test('capsule sweeps find the first finite side or cap hit rather than the perpendicular miss distance', () => {
  const A = math(), hit = (start, end) => A.getLineIntersectSphereOrCapsule(start, end, [5, 0, 0], 1, 2);
  assert.equal(hit([0, 1, 0], [10, 1, 0]), 4);
  assert.equal(hit([5, 5, 0], [5, -5, 0]), 2);
  assert.equal(hit([5, -5, 0], [5, 5, 0]), 4);
  assert.equal(hit([0, 1, 1], [10, 1, 1]), 5);
  assert.equal(hit([5, 1, 0], [10, 1, 0]), 0);
  assert.equal(hit([5, 1, 0], [5, 1, 0]), 0);
  assert.equal(hit([0, 1, 0], [0, 1, 0]), undefined);
  assert.ok(Math.abs(hit([0, 1, 0], [10, 3, 0]) - Math.hypot(10, 2) * 0.4) < 1e-10);
  assert.equal(hit([0, 4, 0], [10, 4, 0]), undefined);
  assert.equal(hit([0, 1, 0], [3, 1, 0]), undefined);
  assert.equal(A.getLineIntersectSphereOrCapsule([0, 0, 0], [10, 0, 0], [5, 0, 0], 1, 0), 4);
});
test('world sphere queries choose the nearest entry, retain zero-distance hits, honor nearer terrain and exclude the shooter', () => {
  const A = math(), owner = { id: 'owner' }, near = { id: 'near' }, far = { id: 'far' };
  const sphere = (entity, x) => ({ entity, getv3Location: () => [x, 0, 0], getRadius: () => 1, getCapsuleHeight: () => 2 });
  const spheres = [sphere(far, 8), sphere(owner, 0), sphere(near, 3)];
  const space = { globals: { mathDevice: A }, scratchpad: {}, getGameGrid: () => ({ applyToPhysicsSpheresWithinExtents: (bounds, visit) => spheres.forEach(visit) }) };
  const query = runtime.method('getCollisionInfoForSpheres');
  const hit = query.call(space, [0, 1, 0], [10, 1, 0], undefined, owner);
  assert.equal(hit.collidedEntity, near); assert.equal(hit.distance, 2);
  assert.deepEqual(Array.from(hit.v3Location), [2, 1, 0]); assert.deepEqual(Array.from(hit.v3Normal), [-1, 0, 0]);
  assert.equal(query.call(space, [0, 1, 0], [10, 1, 0]).distance, 0, 'An inside start is a hit rather than falsy/no collision');
  assert.equal(query.call(space, [0, 1, 0], [10, 1, 0], 1.5, owner), null, 'A farther capsule cannot override nearer terrain');
  spheres.reverse(); assert.equal(query.call(space, [0, 1, 0], [10, 1, 0], undefined, owner).collidedEntity, near);
  space.getCollisionInfoForSpheres = function (...args) { return query.apply(this, args); };
  const game = { globals: { mathDevice: A }, getGameSpaceList: () => [space] };
  const manager = runtime.prototypeWith('updateInterfaceTweens', { qa: { rayTest: () => null } });
  assert.equal(manager.getCollisionInfo.call(game, [0, 1, 0], [10, 1, 0], true, owner).collidedEntity, near, 'The manager carries shooter exclusion through the sphere query');
});
test('a fast projectile hits a second capsule in its first segment rather than losing the whole segment to its owner', () => {
  const A = math(), owner = { isFriendlyWith: () => false }, target = {};
  const spheres = [owner, target].map((entity, index) => ({ entity, getv3Location: () => [index * 3, 0, 0], getRadius: () => 1, getCapsuleHeight: () => 2 }));
  const space = { globals: { mathDevice: A }, scratchpad: {}, getGameGrid: () => ({ applyToPhysicsSpheresWithinExtents: (bounds, visit) => spheres.forEach(visit) }) };
  const query = runtime.method('getCollisionInfoForSpheres'); let impact, destination;
  const projectile = { globals: { gameCurrentTime: 0, mathDevice: A },
    gameManager: { getCollisionInfo: (start, end, spheres, ignored) => query.call(space, start, end, undefined, ignored) },
    ignoresAllies: true, maxImpacts: 1, scratchpad: {}, fireTime: 0, startLocation: [0, 1, 0], v3Velocity: [80, 0, 0],
    getOwner: () => owner, isManagedByThisMachine: () => true, getTimeSinceLastUpdate: () => 0.1, _super() {},
    getv3Location: () => [0, 1, 0], applyRotation() {}, onImpact(entity) { impact = entity; this.entity.toBeDestroyed = true; }, getEntityEC: () => null,
    entity: { setv3Location(point) { destination = point; }, getAge: () => 0 } };
  runtime.component('ECProjectile').update.call(projectile);
  assert.equal(impact, target); assert.deepEqual(Array.from(destination), [2, 1, 0]);
});
