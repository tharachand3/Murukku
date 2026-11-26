import { describe, expect, it } from 'vitest';
import { ROLES } from '../config/roles.js';
import { createRegistry } from './registry.js';

const Page = () => null;
const allRoles = [...ROLES];

function route(path, options = {}) {
  return {
    path,
    component: Page,
    roles: allRoles,
    title: path.slice(1),
    nav: { label: path.slice(1), group: 'Orders' },
    ...options
  };
}

describe('page registry', () => {
  it('rejects duplicate paths, unknown roles, and home roles outside the route roles', () => {
    const registry = createRegistry();
    registry.register(route('/one'));
    expect(() => registry.register(route('/one'))).toThrow('Duplicate route path');
    expect(() => registry.register(route('/unknown', { roles: ['INVALID'] })))
      .toThrow('Route roles must be a non-empty subset of ROLES');
    expect(() => registry.register(route('/home', {
      roles: ['ADMIN'],
      homeFor: ['OWNER']
    }))).toThrow('homeFor roles must be included in route roles');
  });

  it('requires a titled component and a root-relative route path', () => {
    const registry = createRegistry();
    expect(() => registry.register(route('home'))).toThrow('Route path must start with /');
    expect(() => registry.register(route('/missing-title', { title: '' }))).toThrow('Route title is required');
    expect(() => registry.register(route('/missing-component', { component: null })))
      .toThrow('Route component is required');
  });

  it('sorts navigation by group, order, and label while hiding null navigation', () => {
    const registry = createRegistry();
    registry.register(route('/admin', { nav: { label: 'Admin', group: 'Admin', order: 0 } }));
    registry.register(route('/later', { nav: { label: 'Later', group: 'Orders', order: 2 } }));
    registry.register(route('/first-z', { nav: { label: 'Zed', group: 'Orders', order: 1 } }));
    registry.register(route('/first-a', { nav: { label: 'Alpha', group: 'Orders', order: 1 } }));
    registry.register(route('/hidden', { nav: null }));
    registry.register(route('/other', { nav: { label: 'Other', group: 'Other', order: 0 } }));
    expect(registry.navForRole('ADMIN').map(({ path }) => path)).toEqual([
      '/first-a',
      '/first-z',
      '/later',
      '/admin',
      '/other'
    ]);
    expect(registry.navForRole('ADMIN').some(({ path }) => path === '/hidden')).toBe(false);
    expect(registry.routesForRole('SALESMAN')).toHaveLength(6);
  });

  it('returns a registered role home or the /home fallback', () => {
    const registry = createRegistry();
    expect(registry.homePathFor('ADMIN')).toBe('/home');
    registry.register(route('/dashboard', { homeFor: ['ADMIN'] }));
    expect(registry.homePathFor('ADMIN')).toBe('/dashboard');
    expect(registry.homePathFor('OWNER')).toBe('/home');
  });
});
