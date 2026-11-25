export function normalizeIndianPhone(phone) {
  if (typeof phone !== 'string' || !/^[+\d\s()-]+$/.test(phone)) {
    return null;
  }
  const digits = phone.replace(/\D/g, '');
  if (/^[6-9]\d{9}$/.test(digits)) {
    return `91${digits}`;
  }
  if (/^91[6-9]\d{9}$/.test(digits)) {
    return digits;
  }
  return null;
}

export function buildWhatsappUrl({ phone, text }) {
  const normalizedPhone = normalizeIndianPhone(phone);
  const target = normalizedPhone ? `https://wa.me/${normalizedPhone}` : 'https://wa.me/';
  return `${target}?text=${encodeURIComponent(text)}`;
}

export function buildMailtoUrl({ subject, body }) {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
