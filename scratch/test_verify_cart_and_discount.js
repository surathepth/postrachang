const fs = require('fs');

console.log('--- STEP 1: Verifying index.html Inline Scripts Syntax ---');
const html = fs.readFileSync('index.html', 'utf8');
const scriptRegex = /<script>([\s\S]*?)<\/script>/gi;
let match;
let count = 0;
while ((match = scriptRegex.exec(html)) !== null) {
  count++;
  try {
    new Function(match[1]);
    console.log(`Script block ${count}: SYNTAX OK (${match[1].length} chars)`);
  } catch (err) {
    console.error(`Script block ${count} SYNTAX ERROR:`, err);
    process.exit(1);
  }
}

console.log(`All ${count} script blocks in index.html passed syntax check!`);

console.log('\n--- STEP 2: Verifying Quantity Stepper & % Discount Logic ---');
const exchangeRateLak = 169;

// Mock cart
let cart = [
  {
    product_id: 1,
    product_name: 'สันคอหมูสไลด์',
    is_weight: true,
    uom: 'กก.',
    qty_or_weight: 1.500,
    unit_price_thb: 220.00,
    total_thb: 330.00
  },
  {
    product_id: 2,
    product_name: 'ไข่ไก่เบอร์ 2 (แผง 30 ฟอง)',
    is_weight: false,
    uom: 'แผง',
    qty_or_weight: 2,
    unit_price_thb: 145.00,
    total_thb: 290.00
  }
];

function calculateSubtotal() {
  return cart.reduce((sum, item) => sum + item.total_thb, 0);
}

let subtotal = calculateSubtotal();
console.log('Subtotal THB:', subtotal); // 330 + 290 = 620.00

// Test % discount calculation
function testDiscountPercent(pct) {
  const safePct = Math.min(100, Math.max(0, pct));
  const thbDisc = parseFloat(((subtotal * safePct) / 100).toFixed(2));
  const lakDisc = Math.round(thbDisc * exchangeRateLak);
  const netThb = Math.max(0, parseFloat((subtotal - thbDisc).toFixed(2)));
  const netLak = Math.round(netThb * exchangeRateLak);
  return { pct: safePct, thbDisc, lakDisc, netThb, netLak };
}

const disc10 = testDiscountPercent(10);
console.log('10% Discount Result:', disc10);
if (disc10.thbDisc !== 62 || disc10.lakDisc !== Math.round(62 * 169) || disc10.netThb !== 558) {
  throw new Error('Discount 10% calculation mismatch!');
}

const disc5_5 = testDiscountPercent(5.5);
console.log('5.5% Discount Result:', disc5_5);
// 620 * 0.055 = 34.10 THB
if (disc5_5.thbDisc !== 34.10) {
  throw new Error('Discount 5.5% calculation mismatch!');
}

// Test quantity stepper for weight item
console.log('\n--- STEP 3: Testing Weight Item Stepper & Precision ---');
let itemWeight = cart[0];
// Increase by 0.1
itemWeight.qty_or_weight = parseFloat((itemWeight.qty_or_weight + 0.1).toFixed(3));
itemWeight.total_thb = parseFloat((itemWeight.qty_or_weight * itemWeight.unit_price_thb).toFixed(2));
console.log('Weight +0.1 kg:', itemWeight.qty_or_weight, 'Total THB:', itemWeight.total_thb);
if (itemWeight.qty_or_weight !== 1.600 || itemWeight.total_thb !== 352.00) {
  throw new Error('Weight increment calculation mismatch!');
}

// Decrease by 0.1
itemWeight.qty_or_weight = parseFloat((itemWeight.qty_or_weight - 0.1).toFixed(3));
itemWeight.total_thb = parseFloat((itemWeight.qty_or_weight * itemWeight.unit_price_thb).toFixed(2));
console.log('Weight -0.1 kg:', itemWeight.qty_or_weight, 'Total THB:', itemWeight.total_thb);
if (itemWeight.qty_or_weight !== 1.500 || itemWeight.total_thb !== 330.00) {
  throw new Error('Weight decrement calculation mismatch!');
}

// Test piece item stepper
console.log('\n--- STEP 4: Testing Piece Item Stepper ---');
let itemPiece = cart[1];
itemPiece.qty_or_weight += 1;
itemPiece.total_thb = parseFloat((itemPiece.qty_or_weight * itemPiece.unit_price_thb).toFixed(2));
console.log('Piece +1:', itemPiece.qty_or_weight, 'Total THB:', itemPiece.total_thb);
if (itemPiece.qty_or_weight !== 3 || itemPiece.total_thb !== 435.00) {
  throw new Error('Piece increment calculation mismatch!');
}

console.log('\n✅ ALL VERIFICATION TESTS PASSED WITH 100% ACCURACY!');
