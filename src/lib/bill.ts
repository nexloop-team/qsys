// Bill preview. Mirrors private.create_invoice: discount is spread across lines
// by value, then GST is applied per line (inclusive or exclusive prices).

export type BillLine = { amount: number; gstRate: number };

const r2 = (n: number) => Math.round(n * 100) / 100;

export function computeBill(
  lines: BillLine[],
  discount: number,
  opts: { gstEnabled: boolean; pricesIncludeTax: boolean },
) {
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const disc = Math.min(Math.max(discount || 0, 0), subtotal);
  let taxable = 0;
  let tax = 0;

  for (const l of lines) {
    const net = subtotal > 0 ? l.amount - disc * (l.amount / subtotal) : 0;
    const rate = opts.gstEnabled ? l.gstRate : 0;
    if (rate > 0 && opts.pricesIncludeTax) {
      const base = net / (1 + rate / 100);
      taxable += base;
      tax += net - base;
    } else {
      taxable += net;
      tax += (net * rate) / 100;
    }
  }

  tax = r2(tax);
  taxable = r2(taxable);
  const cgst = r2(tax / 2);
  return {
    subtotal: r2(subtotal),
    discount: r2(disc),
    taxable,
    cgst,
    sgst: r2(tax - cgst),
    total: r2(taxable + tax),
  };
}
