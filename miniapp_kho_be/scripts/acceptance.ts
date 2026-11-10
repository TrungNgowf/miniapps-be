/**
 * Kiểm thử đầu-cuối cho API Kho hàng: đăng nhập thật qua portal rồi thử xác thực, phân quyền theo
 * vai trò và đơn vị, nhập/xuất kho, kiểm kê và vòng đời phiếu chuyển kho.
 *
 *   PORTAL_API=http://127.0.0.1:3000 KHO_API=http://127.0.0.1:4100 pnpm accept
 *
 * Script ghi dữ liệu thật vào mutations.jsonl. Chạy `pnpm gen:data` để đưa dữ liệu về ban đầu.
 */
const PORTAL = (process.env.PORTAL_API ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const API = (process.env.KHO_API ?? 'http://127.0.0.1:4100').replace(/\/$/, '');
const PASSWORD = process.env.TEST_PASSWORD ?? 'Abcd@1234';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? '  ok ' : ' FAIL'}  ${name}${ok ? '' : `  → ${detail}`}`);
}

async function login(username: string): Promise<string> {
  const response = await fetch(`${PORTAL}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  const body = (await response.json()) as { accessToken?: string };
  if (!response.ok || !body.accessToken) throw new Error(`Không đăng nhập được ${username}`);
  return body.accessToken;
}

interface Result {
  status: number;
  body: any;
}
async function call(token: string | null, method: string, url: string, body?: unknown): Promise<Result> {
  const response = await fetch(`${API}${url}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function main(): Promise<void> {
  const [keeperCg, cashierRoot, cashierHd, userMp, tinasoft, regionMb, admin] = await Promise.all(
    ['toan.mai', 'nhung.cao', 'lien.ha', 'binh.mac', 'duc.le', 'hung.vo', 'thao.ha'].map(login),
  );
  const k = keeperCg as string;

  console.log('\nXác thực');
  check('không token → 401', (await call(null, 'GET', '/api/me')).status === 401);
  check('token rác → 401', (await call('not-a-token', 'GET', '/api/me')).status === 401);
  const tina = await call(tinasoft as string, 'GET', '/api/me');
  check('user Tinasoft (ngoài Minh Phát) → 403', tina.status === 403, JSON.stringify(tina.body));
  const noRole = await call(userMp as string, 'GET', '/api/me');
  check('USER của Minh Phát (chưa có vai trò kho) → 403', noRole.status === 403, JSON.stringify(noRole.body));

  console.log('\nPhạm vi theo đơn vị');
  const meAdmin = await call(admin as string, 'GET', '/api/me');
  check('ADMIN gốc thấy 7 địa điểm', meAdmin.body?.locations?.length === 7, `${meAdmin.body?.locations?.length}`);
  const meRegion = await call(regionMb as string, 'GET', '/api/me');
  const regionWritable = (meRegion.body?.locations ?? []).filter((l: any) => l.writable).map((l: any) => l.locationId).sort();
  check('REGION_LEAD miền Bắc ghi được 4 cửa hàng miền Bắc', regionWritable.join() === 'mp-cg-01,mp-cg-02,mp-hd-01,mp-hd-02', regionWritable.join());
  const meHd = await call(cashierHd as string, 'GET', '/api/me');
  const hdWritable = (meHd.body?.locations ?? []).filter((l: any) => l.writable).map((l: any) => l.locationId).sort();
  check('thu ngân Hà Đông chỉ ghi được 2 cửa hàng Hà Đông', hdWritable.join() === 'mp-hd-01,mp-hd-02', hdWritable.join());
  check('thu ngân Hà Đông xem được tồn Hà Đông', (await call(cashierHd as string, 'GET', '/api/stock?location=mp-hd-01&limit=5')).status === 200);
  check('thu ngân Hà Đông xem được tồn Kho tổng', (await call(cashierHd as string, 'GET', '/api/stock?location=mp-kho-tong&limit=5')).status === 200);
  check('thu ngân Hà Đông không xem được tồn Cầu Giấy → 403', (await call(cashierHd as string, 'GET', '/api/stock?location=mp-cg-01&limit=5')).status === 403);

  console.log('\nQuyền theo vai trò');
  const cashierAdd = await call(cashierRoot as string, 'POST', '/api/stock/receipts', { locationId: 'mp-hd-01', lines: [{ sku: 'MP100001', qty: 5 }] });
  check('CASHIER không nhập kho được → 403', cashierAdd.status === 403, JSON.stringify(cashierAdd.body));
  const keeperWrong = await call(k, 'POST', '/api/stock/receipts', { locationId: 'mp-hd-01', lines: [{ sku: 'MP100001', qty: 5 }] });
  check('thủ kho Cầu Giấy không nhập vào Hà Đông → 403', keeperWrong.status === 403, JSON.stringify(keeperWrong.body));
  const cashierDetail = await call(cashierRoot as string, 'GET', '/api/products/MP100001');
  check('CASHIER không thấy giá vốn', cashierDetail.status === 200 && cashierDetail.body?.product?.cost === undefined, JSON.stringify(cashierDetail.body?.product));
  const cashierStock = await call(cashierRoot as string, 'GET', '/api/stock?location=mp-hd-01&limit=2');
  check('CASHIER không thấy giá trị tồn theo giá vốn', cashierStock.body?.summary?.value === undefined && cashierStock.body?.items?.[0]?.cost === undefined);
  const managerDetail = await call(regionMb as string, 'GET', '/api/products/MP100001');
  check('REGION_LEAD thấy giá vốn', typeof managerDetail.body?.product?.cost === 'number');
  const keeperMin = await call(k, 'PUT', '/api/stock/mp-cg-01/MP100001/minimum', { min: 5 });
  check('thủ kho không đổi được mức tối thiểu → 403', keeperMin.status === 403);

  console.log('\nNhập kho, kiểm kê, hao hụt');
  const list = await call(k, 'GET', '/api/stock?location=mp-cg-01&limit=3&sort=qty&status=ok');
  const item = list.body?.items?.[0];
  check('liệt kê tồn Cầu Giấy', list.status === 200 && Boolean(item), JSON.stringify(list.body)?.slice(0, 200));
  const sku = item.sku as string;
  const before = item.qty as number;
  const requestId = `acc-${Date.now()}`;
  const receipt = await call(k, 'POST', '/api/stock/receipts', { locationId: 'mp-cg-01', lines: [{ sku, qty: 12 }], note: 'Nhập thử', requestId });
  check('nhập kho 12 → 201', receipt.status === 201, JSON.stringify(receipt.body));
  const replay = await call(k, 'POST', '/api/stock/receipts', { locationId: 'mp-cg-01', lines: [{ sku, qty: 12 }], note: 'Nhập thử', requestId });
  check('gửi lại cùng requestId không nhập trùng', replay.body?.movements?.[0]?.id === receipt.body?.movements?.[0]?.id);
  const detail = await call(k, 'GET', `/api/products/${sku}`);
  const nowQty = detail.body?.stock?.find((s: any) => s.locationId === 'mp-cg-01')?.qty;
  check('tồn tăng đúng 12', nowQty === before + 12, `${before} → ${nowQty}`);
  const stale = await call(k, 'POST', '/api/stock/adjustments', { locationId: 'mp-cg-01', sku, countedQty: 3, expectedQty: before });
  check('kiểm kê với tồn cũ → 409 STALE_STOCK', stale.status === 409 && stale.body?.error?.code === 'STALE_STOCK', JSON.stringify(stale.body));
  const adjust = await call(k, 'POST', '/api/stock/adjustments', { locationId: 'mp-cg-01', sku, countedQty: before + 10, expectedQty: before + 12, note: 'Thiếu 2 so với sổ' });
  check('kiểm kê đúng tồn → 201, chênh -2', adjust.status === 201 && adjust.body?.movement?.qty === -2, JSON.stringify(adjust.body));
  const over = await call(k, 'POST', '/api/stock/waste', { locationId: 'mp-cg-01', sku, qty: 99999, reason: 'Hư hỏng' });
  check('hao hụt vượt tồn → 409', over.status === 409, JSON.stringify(over.body));
  const bad = await call(k, 'POST', '/api/stock/receipts', { locationId: 'mp-cg-01', lines: [{ sku, qty: -3 }] });
  check('số lượng âm → 400', bad.status === 400, JSON.stringify(bad.body));
  const history = await call(k, 'GET', `/api/movements?location=mp-cg-01&sku=${sku}&limit=3`);
  check('nhật ký ghi RECEIPT và ADJUST mới nhất', history.body?.items?.[0]?.type === 'ADJUST' && history.body?.items?.[1]?.type === 'RECEIPT', JSON.stringify(history.body?.items?.map((m: any) => m.type)));
  const chain = (history.body?.items ?? []) as { qty: number; qtyAfter: number }[];
  check('tồn sau mỗi dòng nhật ký nối đúng nhau', chain.length >= 2 && (chain[1] as any).qtyAfter + (chain[0] as any).qty === (chain[0] as any).qtyAfter);
  const minOk = await call(regionMb as string, 'PUT', `/api/stock/mp-cg-01/${sku}/minimum`, { min: 7 });
  check('REGION_LEAD đổi được mức tối thiểu', minOk.status === 200, JSON.stringify(minOk.body));

  console.log('\nChuyển kho');
  const whStock = await call(admin as string, 'GET', '/api/stock?location=mp-kho-tong&limit=2&sort=qty');
  const lineSku = whStock.body?.items?.[0]?.sku as string;
  const whBefore = whStock.body?.items?.[0]?.qty as number;
  const created = await call(k, 'POST', '/api/transfers', { fromLocationId: 'mp-kho-tong', toLocationId: 'mp-cg-01', lines: [{ sku: lineSku, qty: 24 }], note: 'Thử nghiệm' });
  check('thủ kho tạo phiếu Kho tổng → Cầu Giấy', created.status === 201 && created.body?.status === 'REQUESTED', JSON.stringify(created.body));
  const id = created.body?.id as string;
  const selfApprove = await call(k, 'POST', `/api/transfers/${id}/approve`, {});
  check('thủ kho không tự duyệt được → 403', selfApprove.status === 403, JSON.stringify(selfApprove.body));
  const early = await call(admin as string, 'POST', `/api/transfers/${id}/ship`, {});
  check('xuất kho khi chưa duyệt → 409', early.status === 409, JSON.stringify(early.body));
  const approve = await call(admin as string, 'POST', `/api/transfers/${id}/approve`, {});
  check('ADMIN duyệt phiếu', approve.status === 200 && approve.body?.status === 'APPROVED', JSON.stringify(approve.body));
  const ship = await call(admin as string, 'POST', `/api/transfers/${id}/ship`, {});
  check('ADMIN xuất kho', ship.status === 200 && ship.body?.status === 'SHIPPED', JSON.stringify(ship.body));
  const whMid = await call(admin as string, 'GET', `/api/products/${lineSku}`);
  check('Kho tổng giảm 24 khi xuất', whMid.body?.stock?.find((s: any) => s.locationId === 'mp-kho-tong')?.qty === whBefore - 24);
  const receiveWrong = await call(cashierHd as string, 'POST', `/api/transfers/${id}/receive`, {});
  check('đơn vị khác không thấy phiếu → 404', receiveWrong.status === 404, JSON.stringify(receiveWrong.body));
  const cgBefore = (await call(k, 'GET', `/api/products/${lineSku}`)).body?.stock?.find((s: any) => s.locationId === 'mp-cg-01')?.qty ?? 0;
  const overReceive = await call(k, 'POST', `/api/transfers/${id}/receive`, { received: [{ sku: lineSku, qty: 30 }] });
  check('nhận nhiều hơn số gửi → 400', overReceive.status === 400, JSON.stringify(overReceive.body));
  const receive = await call(k, 'POST', `/api/transfers/${id}/receive`, { received: [{ sku: lineSku, qty: 22 }], note: 'Hỏng 2 thùng' });
  check('thủ kho nhận 22/24', receive.status === 200 && receive.body?.status === 'RECEIVED' && receive.body?.lines?.[0]?.receivedQty === 22, JSON.stringify(receive.body));
  const cgAfter = (await call(k, 'GET', `/api/products/${lineSku}`)).body?.stock?.find((s: any) => s.locationId === 'mp-cg-01')?.qty;
  check('Cầu Giấy tăng đúng 22', cgAfter === cgBefore + 22, `${cgBefore} → ${cgAfter}`);
  const again = await call(k, 'POST', `/api/transfers/${id}/receive`, {});
  check('nhận lần hai → 409', again.status === 409, JSON.stringify(again.body));

  console.log('\nBáo cáo');
  const dash = await call(regionMb as string, 'GET', '/api/dashboard?days=30');
  check('dashboard miền Bắc có doanh thu và top bán chạy', dash.status === 200 && dash.body?.sales?.revenue > 0 && dash.body?.top?.length === 10, JSON.stringify(dash.body)?.slice(0, 160));
  const dashCg = await call(k, 'GET', '/api/dashboard?location=mp-hd-01');
  check('thủ kho Cầu Giấy không xem được dashboard Hà Đông → 403', dashCg.status === 403);
  const repl = await call(k, 'GET', '/api/replenishment?location=mp-cg-01');
  check('gợi ý bổ sung hàng', repl.status === 200 && Array.isArray(repl.body?.items), JSON.stringify(repl.body)?.slice(0, 160));

  console.log(`\n${passed} đạt, ${failed} lỗi`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
