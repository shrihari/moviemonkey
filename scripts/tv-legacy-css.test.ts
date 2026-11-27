import { describe, expect, it } from 'vitest';
import { expandSelectorList, legacyCss } from './tv-legacy-css';

describe('expandSelectorList', () => {
  it('writes out group variants', () => {
    expect(expandSelectorList('.group-focus\\:ring-white:is(:where(.group):focus *)')).toBe(
      ':focus.group .group-focus\\:ring-white',
    );
  });

  it('unwraps a whole-selector :where', () => {
    expect(expandSelectorList(':where(.space-y-4>:not(:last-child))')).toBe('.space-y-4>:not(:last-child)');
  });

  it('expands lists, nested ones too', () => {
    expect(expandSelectorList(':where(select:is([multiple],[size])) optgroup')).toBe(
      'select[multiple] optgroup,select[size] optgroup',
    );
    expect(expandSelectorList('.a:is(.b,.c),.d')).toBe('.a.b,.a.c,.d');
  });

  it('keeps :not() and pseudo-elements in place', () => {
    expect(expandSelectorList('[hidden]:where(:not([hidden=until-found]))')).toBe('[hidden]:not([hidden=until-found])');
    expect(expandSelectorList('.x:is(.y)::placeholder')).toBe('.x.y::placeholder');
    expect(expandSelectorList('input:where([type=button])')).toBe('input[type=button]');
  });

  it("doesn't take an escaped class apart", () => {
    // `.\32 xl\:p-4` is the class "2xl:p-4": the space ends the escape.
    expect(expandSelectorList('.\\32 xl\\:p-4:is(:where(.group):hover *)')).toBe(':hover.group .\\32 xl\\:p-4');
  });

  it('leaves other selectors alone', () => {
    expect(expandSelectorList('.a > .b ~ .c, html')).toBe('.a > .b ~ .c,html');
  });
});

describe('legacyCss', () => {
  const tailwindish = `
    @layer properties{@supports (((-webkit-hyphens:none))){*,:before,:after{--tw-scale-x:1}}}
    @layer theme,base,components,utilities;
    @layer theme{:root{--color-white:#fff}}
    @layer base{*{margin:0}}
    @layer components;
    @layer utilities{
      .bg-accent\\/25{background-color:oklab(86.5% .007 .159/.25)}
      .inset-0{inset:0}
      .-translate-x-1\\/2{--tw-translate-x:calc(1/2*100%*-1);translate:var(--tw-translate-x) var(--tw-translate-y)}
      .focus\\:scale-110:focus{--tw-scale-x:110%;--tw-scale-y:110%;scale:var(--tw-scale-x) var(--tw-scale-y)}
      .group-focus\\:opacity-100:is(:where(.group):focus *){opacity:1}
      .bg-gradient-to-t{--tw-gradient-position:to top in oklab;background-image:linear-gradient(var(--tw-gradient-stops))}
    }
    .unlayered{color:red}`;
  const out = legacyCss(tailwindish);

  it('unwraps cascade layers in order', () => {
    expect(out).not.toContain('@layer');
    expect(out.indexOf('--color-white')).toBeLessThan(out.indexOf('.inset-0'));
    expect(out.indexOf('.inset-0')).toBeLessThan(out.indexOf('.unlayered'));
  });

  it('gives Tailwind variables their starting values everywhere', () => {
    expect(out).toContain('--tw-scale-x:1');
    expect(out).not.toContain('-webkit-hyphens');
  });

  it('lowers new colours and properties', () => {
    expect(out).toMatch(/background-color:#[0-9a-f]{8}/);
    expect(out).toContain('top:0');
    expect(out).not.toMatch(/[{;]inset:/);
  });

  it('writes out :is() and :where()', () => {
    expect(out).not.toMatch(/:(is|where)\(/);
    expect(out).toContain(':focus.group .group-focus\\:opacity-100');
  });

  it('falls back to transform for translate and scale', () => {
    expect(out).toContain('@supports not (translate:0)');
    expect(out).toMatch(/\.focus\\:scale-110:focus\{--tw-fallback-scale:1\.1;transform:translate\(/);
    expect(out).toContain('*,:before,:after{--tw-fallback-scale:1');
  });

  it('gives gradients a plain version first', () => {
    expect(out).toContain('.bg-gradient-to-t{--tw-gradient-position:to top;');
    expect(out).toContain(
      '@supports (background-image:linear-gradient(in oklab,red,red)){.bg-gradient-to-t{--tw-gradient-position:to top in oklab}}',
    );
  });
});
