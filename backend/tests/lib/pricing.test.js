import { describe, expect, it } from 'vitest';
import { pickPrice } from '../../src/lib/pricing.js';

describe('pickPrice', () => {
  it('uses a positive customer price first and ignores unset prices', () => {
    expect(pickPrice({
      customerPricePaise: 7000,
      defaultPricePaise: 5000
    })).toEqual({ pricePaise: 7000, source: 'CUSTOMER' });
    expect(pickPrice({
      customerPricePaise: 0,
      defaultPricePaise: 5000
    })).toEqual({ pricePaise: 5000, source: 'DEFAULT' });
    expect(pickPrice({
      customerPricePaise: null,
      defaultPricePaise: null
    })).toBeNull();
    expect(pickPrice({
      customerPricePaise: -1,
      defaultPricePaise: 0
    })).toBeNull();
  });
});
