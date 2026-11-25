const SMALL = [
  'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight',
  'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen',
  'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'
];
const TENS = [
  '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy',
  'Eighty', 'Ninety'
];
const MAX_PAISE = 100000000000;

function underThousand(value) {
  const words = [];
  if (value >= 100) {
    words.push(SMALL[Math.floor(value / 100)], 'Hundred');
    value %= 100;
  }
  if (value >= 20) {
    words.push(TENS[Math.floor(value / 10)]);
    value %= 10;
  }
  if (value > 0) {
    words.push(SMALL[value]);
  }
  return words.join(' ');
}

function indianNumberWords(value) {
  const groups = [
    [10000000, 'Crore'],
    [100000, 'Lakh'],
    [1000, 'Thousand']
  ];
  const words = [];
  let remainder = value;

  for (const [size, label] of groups) {
    const count = Math.floor(remainder / size);
    if (count > 0) {
      words.push(underThousand(count), label);
      remainder %= size;
    }
  }
  if (remainder > 0) {
    words.push(underThousand(remainder));
  }
  return words.join(' ');
}

export function paiseToWords(paise) {
  if (
    !Number.isSafeInteger(paise) ||
    paise < 0 ||
    paise > MAX_PAISE
  ) {
    throw new RangeError('Paise must be a non-negative integer up to 100000000000');
  }
  if (paise === 0) {
    return 'Rupees Zero Only';
  }

  const rupees = Math.floor(paise / 100);
  const remainder = paise % 100;
  if (rupees === 0) {
    return `${indianNumberWords(remainder)} Paise Only`;
  }

  const amount = `Rupees ${indianNumberWords(rupees)}`;
  return remainder === 0
    ? `${amount} Only`
    : `${amount} and ${indianNumberWords(remainder)} Paise Only`;
}
