import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from './errors.js';
import { buildAccess, capabilitiesOf, isWithin, requireCap, requireScope } from './access.js';
import type { Location, Principal } from './types.js';

const place = (locationId: string, tenantId: string, kind: Location['kind'] = 'store'): Location => ({
  locationId,
  tenantId,
  kind,
  name: locationId,
  address: '',
  district: '',
  province: '',
  openedAt: '2020-01-01',
});

const locations = [
  place('kho', 'minhphat', 'warehouse'),
  place('hd', 'minhphat-hadong'),
  place('cg', 'minhphat-caugiay'),
  place('hcm', 'minhphat-mn'),
];

const who = (tenantId: string, roles: string[]): Principal => ({
  userId: 'u1',
  username: 'u1',
  fullName: 'U1',
  tenantId,
  tenantName: tenantId,
  roles,
});

test('quyền ở tenant cha kế thừa xuống tenant con', () => {
  assert.equal(isWithin('minhphat-hadong', 'minhphat-mb'), true);
  assert.equal(isWithin('minhphat-hadong', 'minhphat'), true);
  assert.equal(isWithin('minhphat-mn', 'minhphat-mb'), false);
  assert.equal(isWithin('tinasoft', 'minhphat'), false);
});

test('phạm vi theo tenant của người dùng', () => {
  const store = buildAccess(who('minhphat-hadong', ['STORE_KEEPER']), locations);
  assert.deepEqual([...store.scope], ['hd']);
  assert.deepEqual([...store.readable].sort(), ['hd', 'kho']);
  const region = buildAccess(who('minhphat-mb', ['REGION_LEAD']), locations);
  assert.deepEqual([...region.scope].sort(), ['cg', 'hd']);
  const root = buildAccess(who('minhphat', ['ADMIN']), locations);
  assert.equal(root.scope.size, 4);
});

test('từ chối tài khoản ngoài Minh Phát hoặc chưa có vai trò kho', () => {
  assert.throws(() => buildAccess(who('tinasoft', ['ADMIN']), locations), (e) => e instanceof ApiError && e.status === 403);
  assert.throws(() => buildAccess(who('minhphat', ['USER']), locations), (e) => e instanceof ApiError && e.status === 403);
});

test('thu ngân chỉ được xem, thủ kho không đặt được mức tối thiểu', () => {
  assert.deepEqual(capabilitiesOf(['CASHIER']), ['stock.read']);
  const keeper = buildAccess(who('minhphat-hadong', ['STORE_KEEPER']), locations);
  assert.throws(() => requireCap(keeper, 'stock.minimum'), ApiError);
  assert.doesNotThrow(() => requireCap(keeper, 'stock.write'));
});

test('ghi chỉ trong phạm vi, đọc được thêm Kho tổng', () => {
  const keeper = buildAccess(who('minhphat-hadong', ['STORE_KEEPER']), locations);
  assert.doesNotThrow(() => requireScope(keeper, 'hd', 'write'));
  assert.throws(() => requireScope(keeper, 'cg', 'write'), ApiError);
  assert.doesNotThrow(() => requireScope(keeper, 'kho', 'read'));
  assert.throws(() => requireScope(keeper, 'kho', 'write'), ApiError);
});
