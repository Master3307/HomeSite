/*
 * The formula collection on /dash (search "formulas", or a formula's name):
 * maths at Realschule / FOS level, physics, metalwork (as in the Tabellenbuch
 * Metall), pneumatics and hydraulics, chemistry. Names, explanations and what
 * the letters mean are in src/locales/<lang>/formulas.json (items.<id>).
 *
 * Every formula is written in the calculator's own notation (lib/dashMath.js),
 * so the same text is typeset and calculated with:
 *   show      what is shown
 *   solve     the equation the little calculator solves (leave one value empty);
 *             absent for rules that hold for every value (binomial formulas …)
 *   vars      letter -> unit in which it is typed and shown ('' = no unit);
 *             { unit, value } for constants filled in already (g = 9.81)
 *   forms     the same formula solved for the other letters
 *   methods   true when the language file has worked methods (items.<id>.methods)
 *   angle     'deg' for formulas with angles in degrees
 * Notation follows Bavarian schools: f(x) = mx + t, Mitternachtsformel,
 * Federhärte D, Ortsfaktor g = 9.81 N/kg, A = π·d²/4 in the Tabellenbuch.
 */

const G = { unit: 'N/kg', value: 9.81 }

export const FORMULA_AREAS = [
  { id: 'math', icon: 'function', topics: ['functions', 'quadratic', 'powers', 'triangles', 'plane', 'solids', 'percent', 'growth'] },
  { id: 'physics', icon: 'speed', topics: ['motion', 'forces', 'pressure', 'energy', 'heat', 'electricity', 'waves', 'atoms'] },
  { id: 'metal', icon: 'construction', topics: ['cutting', 'strength', 'drives', 'gears', 'fits', 'shapes'] },
  { id: 'fluid', icon: 'air', topics: ['pneumatics', 'hydraulics'] },
  { id: 'chemistry', icon: 'science', topics: ['amount', 'solutions'] },
]

export const FORMULAS = [
  /* ---------- maths: functions ---------- */
  { id: 'line', area: 'math', topic: 'functions', show: 'y = m*x + t', solve: 'y = m*x + t', vars: { y: '', m: '', x: '', t: '' }, forms: ['m = (y - t)/x', 't = y - m*x', 'x = (y - t)/m'] },
  { id: 'slope', area: 'math', topic: 'functions', show: 'm = (y_2 - y_1)/(x_2 - x_1)', solve: 'm = (y_2 - y_1)/(x_2 - x_1)', vars: { m: '', x_1: '', y_1: '', x_2: '', y_2: '' } },
  { id: 'lineZero', area: 'math', topic: 'functions', show: 'x_0 = -t/m', solve: 'x_0 = -t/m', vars: { x_0: '', t: '', m: '' } },
  { id: 'distance', area: 'math', topic: 'functions', show: 'd = sqrt((x_2 - x_1)^2 + (y_2 - y_1)^2)', solve: 'd = sqrt((x_2 - x_1)^2 + (y_2 - y_1)^2)', vars: { d: '', x_1: '', y_1: '', x_2: '', y_2: '' } },
  { id: 'midpoint', area: 'math', topic: 'functions', show: 'x_M = (x_1 + x_2)/2', solve: 'x_M = (x_1 + x_2)/2', vars: { x_M: '', x_1: '', x_2: '' } },
  /* ---------- maths: quadratic ---------- */
  { id: 'vertexForm', area: 'math', topic: 'quadratic', show: 'y = a*(x - x_S)^2 + y_S', solve: 'y = a*(x - x_S)^2 + y_S', vars: { y: '', a: '', x: '', x_S: '', y_S: '' } },
  { id: 'vertex', area: 'math', topic: 'quadratic', show: 'x_S = -b/(2*a)', solve: 'x_S = -b/(2*a)', vars: { x_S: '', a: '', b: '' }, forms: ['y_S = c - b^2/(4*a)'] },
  { id: 'midnight', area: 'math', topic: 'quadratic', show: 'x_1_2 = (-b ± sqrt(b^2 - 4*a*c))/(2*a)', solve: 'a*x^2 + b*x + c = 0', vars: { a: '', b: '', c: '', x: '' }, alias: { x_1_2: 'x' }, methods: true },
  { id: 'discriminant', area: 'math', topic: 'quadratic', show: 'D = b^2 - 4*a*c', solve: 'D = b^2 - 4*a*c', vars: { D: '', a: '', b: '', c: '' } },
  { id: 'pq', area: 'math', topic: 'quadratic', show: 'x_1_2 = -p/2 ± sqrt((p/2)^2 - q)', solve: 'x^2 + p*x + q = 0', vars: { p: '', q: '', x: '' }, alias: { x_1_2: 'x' } },
  { id: 'binomial1', area: 'math', topic: 'quadratic', show: '(a + b)^2 = a^2 + 2*a*b + b^2' },
  { id: 'binomial2', area: 'math', topic: 'quadratic', show: '(a - b)^2 = a^2 - 2*a*b + b^2' },
  { id: 'binomial3', area: 'math', topic: 'quadratic', show: '(a + b)*(a - b) = a^2 - b^2' },
  /* ---------- maths: powers, roots, logarithms ---------- */
  { id: 'powerProduct', area: 'math', topic: 'powers', show: 'a^m*a^n = a^(m + n)' },
  { id: 'powerQuotient', area: 'math', topic: 'powers', show: 'a^m/a^n = a^(m - n)' },
  { id: 'powerPower', area: 'math', topic: 'powers', show: '(a^m)^n = a^(m*n)' },
  { id: 'powerProductBase', area: 'math', topic: 'powers', show: 'a^n*b^n = (a*b)^n' },
  { id: 'powerNegative', area: 'math', topic: 'powers', show: 'a^(-n) = 1/a^n' },
  { id: 'powerRoot', area: 'math', topic: 'powers', show: 'a^(1/n) = root(a, n)' },
  { id: 'logDefinition', area: 'math', topic: 'powers', show: 'b^x = a', solve: 'b^x = a', vars: { b: '', x: '', a: '' }, forms: ['x = log(a, b)'] },
  { id: 'logProduct', area: 'math', topic: 'powers', show: 'log(u*v, b) = log(u, b) + log(v, b)' },
  { id: 'logQuotient', area: 'math', topic: 'powers', show: 'log(u/v, b) = log(u, b) - log(v, b)' },
  { id: 'logPower', area: 'math', topic: 'powers', show: 'log(u^r, b) = r*log(u, b)' },
  { id: 'logChange', area: 'math', topic: 'powers', show: 'log(a, b) = lg(a)/lg(b)' },
  /* ---------- maths: triangles ---------- */
  { id: 'pythagoras', area: 'math', topic: 'triangles', show: 'a^2 + b^2 = c^2', solve: 'a^2 + b^2 = c^2', vars: { a: 'cm', b: 'cm', c: 'cm' }, forms: ['c = sqrt(a^2 + b^2)', 'a = sqrt(c^2 - b^2)', 'b = sqrt(c^2 - a^2)'] },
  { id: 'legTheorem', area: 'math', topic: 'triangles', show: 'a^2 = c*p', solve: 'a^2 = c*p', vars: { a: 'cm', c: 'cm', p: 'cm' } },
  { id: 'altitudeTheorem', area: 'math', topic: 'triangles', show: 'h^2 = p*q', solve: 'h^2 = p*q', vars: { h: 'cm', p: 'cm', q: 'cm' } },
  { id: 'sine', area: 'math', topic: 'triangles', show: 'sin(alpha) = a/c', solve: 'sin(alpha) = a/c', vars: { alpha: '°', a: 'cm', c: 'cm' }, angle: 'deg', forms: ['cos(alpha) = b/c', 'tan(alpha) = a/b'] },
  { id: 'lawOfSines', area: 'math', topic: 'triangles', show: 'a/sin(alpha) = b/sin(beta)', solve: 'a/sin(alpha) = b/sin(beta)', vars: { a: 'cm', alpha: '°', b: 'cm', beta: '°' }, angle: 'deg' },
  { id: 'lawOfCosines', area: 'math', topic: 'triangles', show: 'c^2 = a^2 + b^2 - 2*a*b*cos(gamma)', solve: 'c^2 = a^2 + b^2 - 2*a*b*cos(gamma)', vars: { c: 'cm', a: 'cm', b: 'cm', gamma: '°' }, angle: 'deg' },
  { id: 'triangleSine', area: 'math', topic: 'triangles', show: 'A = 1/2*a*b*sin(gamma)', solve: 'A = 1/2*a*b*sin(gamma)', vars: { A: 'cm²', a: 'cm', b: 'cm', gamma: '°' }, angle: 'deg' },
  { id: 'trigIdentity', area: 'math', topic: 'triangles', show: 'sin(alpha)^2 + cos(alpha)^2 = 1' },
  { id: 'radians', area: 'math', topic: 'triangles', show: 'x = alpha/180*pi', solve: 'x = alpha/180*pi', vars: { x: '', alpha: '°' } },
  /* ---------- maths: plane figures ---------- */
  { id: 'rectangle', area: 'math', topic: 'plane', show: 'A = a*b', solve: 'A = a*b', vars: { A: 'cm²', a: 'cm', b: 'cm' }, forms: ['U = 2*(a + b)'] },
  { id: 'square', area: 'math', topic: 'plane', show: 'A = a^2', solve: 'A = a^2', vars: { A: 'cm²', a: 'cm' }, forms: ['U = 4*a', 'd = a*sqrt(2)'] },
  { id: 'triangle', area: 'math', topic: 'plane', show: 'A = 1/2*g*h', solve: 'A = 1/2*g*h', vars: { A: 'cm²', g: 'cm', h: 'cm' } },
  { id: 'parallelogram', area: 'math', topic: 'plane', show: 'A = g*h', solve: 'A = g*h', vars: { A: 'cm²', g: 'cm', h: 'cm' } },
  { id: 'trapezoid', area: 'math', topic: 'plane', show: 'A = 1/2*(a + c)*h', solve: 'A = 1/2*(a + c)*h', vars: { A: 'cm²', a: 'cm', c: 'cm', h: 'cm' } },
  { id: 'kite', area: 'math', topic: 'plane', show: 'A = 1/2*e*f', solve: 'A = 1/2*e*f', vars: { A: 'cm²', e: 'cm', f: 'cm' } },
  { id: 'circle', area: 'math', topic: 'plane', show: 'A = pi*r^2', solve: 'A = pi*r^2', vars: { A: 'cm²', r: 'cm' }, forms: ['U = 2*pi*r', 'A = pi*d^2/4'] },
  { id: 'sector', area: 'math', topic: 'plane', show: 'A = alpha/360*pi*r^2', solve: 'A = alpha/360*pi*r^2', vars: { A: 'cm²', alpha: '°', r: 'cm' }, forms: ['b = alpha/360*2*pi*r'] },
  /* ---------- maths: solids ---------- */
  { id: 'cube', area: 'math', topic: 'solids', show: 'V = a^3', solve: 'V = a^3', vars: { V: 'cm³', a: 'cm' }, forms: ['O = 6*a^2'] },
  { id: 'cuboid', area: 'math', topic: 'solids', show: 'V = a*b*c', solve: 'V = a*b*c', vars: { V: 'cm³', a: 'cm', b: 'cm', c: 'cm' }, forms: ['O = 2*(a*b + a*c + b*c)'] },
  { id: 'prism', area: 'math', topic: 'solids', show: 'V = G*h', solve: 'V = G*h', vars: { V: 'cm³', G: 'cm²', h: 'cm' } },
  { id: 'cylinder', area: 'math', topic: 'solids', show: 'V = pi*r^2*h', solve: 'V = pi*r^2*h', vars: { V: 'cm³', r: 'cm', h: 'cm' }, forms: ['M = 2*pi*r*h', 'O = 2*pi*r^2 + 2*pi*r*h'] },
  { id: 'pyramid', area: 'math', topic: 'solids', show: 'V = 1/3*G*h', solve: 'V = 1/3*G*h', vars: { V: 'cm³', G: 'cm²', h: 'cm' } },
  { id: 'cone', area: 'math', topic: 'solids', show: 'V = 1/3*pi*r^2*h', solve: 'V = 1/3*pi*r^2*h', vars: { V: 'cm³', r: 'cm', h: 'cm' }, forms: ['s = sqrt(r^2 + h^2)', 'M = pi*r*s', 'O = pi*r^2 + pi*r*s'] },
  { id: 'sphere', area: 'math', topic: 'solids', show: 'V = 4/3*pi*r^3', solve: 'V = 4/3*pi*r^3', vars: { V: 'cm³', r: 'cm' }, forms: ['O = 4*pi*r^2'] },
  /* ---------- maths: percent and interest ---------- */
  { id: 'percent', area: 'math', topic: 'percent', show: 'W = G*p/100', solve: 'W = G*p/100', vars: { W: '', G: '', p: '%' }, forms: ['G = W*100/p', 'p = W/G*100'], methods: true },
  { id: 'interest', area: 'math', topic: 'percent', show: 'Z = K*p/100', solve: 'Z = K*p/100', vars: { Z: '€', K: '€', p: '%' } },
  { id: 'interestDays', area: 'math', topic: 'percent', show: 'Z = K*p*t/(100*360)', solve: 'Z = K*p*t/(100*360)', vars: { Z: '€', K: '€', p: '%', t: 'd' } },
  { id: 'compound', area: 'math', topic: 'percent', show: 'K_n = K_0*(1 + p/100)^n', solve: 'K_n = K_0*(1 + p/100)^n', vars: { K_n: '€', K_0: '€', p: '%', n: '' } },
  /* ---------- maths: growth ---------- */
  { id: 'growth', area: 'math', topic: 'growth', show: 'y = y_0*a^x', solve: 'y = y_0*a^x', vars: { y: '', y_0: '', a: '', x: '' } },
  { id: 'growthPercent', area: 'math', topic: 'growth', show: 'a = 1 + p/100', solve: 'a = 1 + p/100', vars: { a: '', p: '%' } },

  /* ---------- physics: motion ---------- */
  { id: 'speed', area: 'physics', topic: 'motion', show: 'v = s/t', solve: 'v = s/t', vars: { v: 'm/s', s: 'm', t: 's' }, forms: ['s = v*t', 't = s/v'] },
  { id: 'acceleration', area: 'physics', topic: 'motion', show: 'a = Δv/Δt', solve: 'a = Δv/Δt', vars: { a: 'm/s²', Δv: 'm/s', Δt: 's' } },
  { id: 'accelDistance', area: 'physics', topic: 'motion', show: 's = 1/2*a*t^2', solve: 's = 1/2*a*t^2', vars: { s: 'm', a: 'm/s²', t: 's' }, forms: ['v = a*t', 'v = sqrt(2*a*s)'] },
  { id: 'freeFall', area: 'physics', topic: 'motion', show: 'h = 1/2*g*t^2', solve: 'h = 1/2*g*t^2', vars: { h: 'm', g: { unit: 'm/s²', value: 9.81 }, t: 's' }, forms: ['v = g*t'] },
  { id: 'circularSpeed', area: 'physics', topic: 'motion', show: 'v = 2*pi*r/T', solve: 'v = 2*pi*r/T', vars: { v: 'm/s', r: 'm', T: 's' } },
  { id: 'momentum', area: 'physics', topic: 'motion', show: 'p = m*v', solve: 'p = m*v', vars: { p: 'kg·m/s', m: 'kg', v: 'm/s' } },
  /* ---------- physics: forces ---------- */
  { id: 'newton', area: 'physics', topic: 'forces', show: 'F = m*a', solve: 'F = m*a', vars: { F: 'N', m: 'kg', a: 'm/s²' } },
  { id: 'weight', area: 'physics', topic: 'forces', show: 'F_G = m*g', solve: 'F_G = m*g', vars: { F_G: 'N', m: 'kg', g: G } },
  { id: 'spring', area: 'physics', topic: 'forces', show: 'F = D*s', solve: 'F = D*s', vars: { F: 'N', D: 'N/m', s: 'm' } },
  { id: 'lever', area: 'physics', topic: 'forces', show: 'F_1*a_1 = F_2*a_2', solve: 'F_1*a_1 = F_2*a_2', vars: { F_1: 'N', a_1: 'm', F_2: 'N', a_2: 'm' } },
  { id: 'torque', area: 'physics', topic: 'forces', show: 'M = F*a', solve: 'M = F*a', vars: { M: 'N·m', F: 'N', a: 'm' } },
  { id: 'centripetal', area: 'physics', topic: 'forces', show: 'F_Z = m*v^2/r', solve: 'F_Z = m*v^2/r', vars: { F_Z: 'N', m: 'kg', v: 'm/s', r: 'm' } },
  { id: 'density', area: 'physics', topic: 'forces', show: 'rho = m/V', solve: 'rho = m/V', vars: { rho: 'g/cm³', m: 'g', V: 'cm³' } },
  /* ---------- physics: pressure ---------- */
  { id: 'pressure', area: 'physics', topic: 'pressure', show: 'p = F/A', solve: 'p = F/A', vars: { p: 'Pa', F: 'N', A: 'm²' } },
  { id: 'hydrostatic', area: 'physics', topic: 'pressure', show: 'p = rho*g*h', solve: 'p = rho*g*h', vars: { p: 'Pa', rho: 'kg/m³', g: G, h: 'm' } },
  { id: 'buoyancy', area: 'physics', topic: 'pressure', show: 'F_A = rho_Fl*g*V', solve: 'F_A = rho_Fl*g*V', vars: { F_A: 'N', rho_Fl: 'kg/m³', g: G, V: 'm³' } },
  /* ---------- physics: work, energy, power ---------- */
  { id: 'work', area: 'physics', topic: 'energy', show: 'W = F*s', solve: 'W = F*s', vars: { W: 'J', F: 'N', s: 'm' } },
  { id: 'liftingWork', area: 'physics', topic: 'energy', show: 'W = m*g*h', solve: 'W = m*g*h', vars: { W: 'J', m: 'kg', g: G, h: 'm' } },
  { id: 'kinetic', area: 'physics', topic: 'energy', show: 'E_kin = 1/2*m*v^2', solve: 'E_kin = 1/2*m*v^2', vars: { E_kin: 'J', m: 'kg', v: 'm/s' } },
  { id: 'potential', area: 'physics', topic: 'energy', show: 'E_pot = m*g*h', solve: 'E_pot = m*g*h', vars: { E_pot: 'J', m: 'kg', g: G, h: 'm' } },
  { id: 'springEnergy', area: 'physics', topic: 'energy', show: 'E_Sp = 1/2*D*s^2', solve: 'E_Sp = 1/2*D*s^2', vars: { E_Sp: 'J', D: 'N/m', s: 'm' } },
  { id: 'power', area: 'physics', topic: 'energy', show: 'P = W/t', solve: 'P = W/t', vars: { P: 'W', W: 'J', t: 's' }, forms: ['P = F*v'] },
  { id: 'efficiency', area: 'physics', topic: 'energy', show: 'eta = E_nutz/E_zu', solve: 'eta = E_nutz/E_zu', vars: { eta: '', E_nutz: 'J', E_zu: 'J' }, forms: ['eta = P_nutz/P_zu'] },
  /* ---------- physics: heat ---------- */
  { id: 'heat', area: 'physics', topic: 'heat', show: 'Q = c*m*ΔT', solve: 'Q = c*m*ΔT', vars: { Q: 'J', c: 'J/(kg·K)', m: 'kg', ΔT: 'K' } },
  { id: 'kelvin', area: 'physics', topic: 'heat', show: 'T = theta + 273.15', solve: 'T = theta + 273.15', vars: { T: 'K', theta: '°C' } },
  { id: 'expansion', area: 'physics', topic: 'heat', show: 'Δl = alpha*l_0*ΔT', solve: 'Δl = alpha*l_0*ΔT', vars: { Δl: 'mm', alpha: '1/K', l_0: 'mm', ΔT: 'K' } },
  /* ---------- physics: electricity ---------- */
  { id: 'ohm', area: 'physics', topic: 'electricity', show: 'U = R*I', solve: 'U = R*I', vars: { U: 'V', R: 'Ω', I: 'A' }, forms: ['R = U/I', 'I = U/R'] },
  { id: 'electricPower', area: 'physics', topic: 'electricity', show: 'P = U*I', solve: 'P = U*I', vars: { P: 'W', U: 'V', I: 'A' } },
  { id: 'electricEnergy', area: 'physics', topic: 'electricity', show: 'W = U*I*t', solve: 'W = U*I*t', vars: { W: 'J', U: 'V', I: 'A', t: 's' } },
  { id: 'charge', area: 'physics', topic: 'electricity', show: 'Q = I*t', solve: 'Q = I*t', vars: { Q: 'C', I: 'A', t: 's' } },
  { id: 'wireResistance', area: 'physics', topic: 'electricity', show: 'R = rho*l/A', solve: 'R = rho*l/A', vars: { R: 'Ω', rho: 'Ω·mm²/m', l: 'm', A: 'mm²' } },
  { id: 'series', area: 'physics', topic: 'electricity', show: 'R = R_1 + R_2', solve: 'R = R_1 + R_2', vars: { R: 'Ω', R_1: 'Ω', R_2: 'Ω' } },
  { id: 'parallel', area: 'physics', topic: 'electricity', show: '1/R = 1/R_1 + 1/R_2', solve: '1/R = 1/R_1 + 1/R_2', vars: { R: 'Ω', R_1: 'Ω', R_2: 'Ω' }, forms: ['R = R_1*R_2/(R_1 + R_2)'] },
  { id: 'transformer', area: 'physics', topic: 'electricity', show: 'U_1/U_2 = N_1/N_2', solve: 'U_1/U_2 = N_1/N_2', vars: { U_1: 'V', U_2: 'V', N_1: '', N_2: '' }, forms: ['I_1/I_2 = N_2/N_1'] },
  /* ---------- physics: waves and optics ---------- */
  { id: 'frequency', area: 'physics', topic: 'waves', show: 'f = 1/T', solve: 'f = 1/T', vars: { f: 'Hz', T: 's' } },
  { id: 'wave', area: 'physics', topic: 'waves', show: 'c = lambda*f', solve: 'c = lambda*f', vars: { c: 'm/s', lambda: 'm', f: 'Hz' } },
  { id: 'lens', area: 'physics', topic: 'waves', show: '1/f = 1/g + 1/b', solve: '1/f = 1/g + 1/b', vars: { f: 'cm', g: 'cm', b: 'cm' } },
  { id: 'magnification', area: 'physics', topic: 'waves', show: 'B/G = b/g', solve: 'B/G = b/g', vars: { B: 'cm', G: 'cm', b: 'cm', g: 'cm' } },
  /* ---------- physics: atoms ---------- */
  { id: 'decay', area: 'physics', topic: 'atoms', show: 'N = N_0*(1/2)^(t/T_H)', solve: 'N = N_0*(1/2)^(t/T_H)', vars: { N: '', N_0: '', t: 'a', T_H: 'a' } },

  /* ---------- metal: cutting ---------- */
  { id: 'cuttingSpeed', area: 'metal', topic: 'cutting', show: 'v_c = pi*d*n/1000', solve: 'v_c = pi*d*n/1000', vars: { v_c: 'm/min', d: 'mm', n: '1/min' }, forms: ['n = 1000*v_c/(pi*d)', 'd = 1000*v_c/(pi*n)'] },
  { id: 'feedTurning', area: 'metal', topic: 'cutting', show: 'v_f = f*n', solve: 'v_f = f*n', vars: { v_f: 'mm/min', f: 'mm', n: '1/min' } },
  { id: 'feedMilling', area: 'metal', topic: 'cutting', show: 'v_f = f_z*z*n', solve: 'v_f = f_z*z*n', vars: { v_f: 'mm/min', f_z: 'mm', z: '', n: '1/min' } },
  { id: 'mainTime', area: 'metal', topic: 'cutting', show: 't_h = L*i/(n*f)', solve: 't_h = L*i/(n*f)', vars: { t_h: 'min', L: 'mm', i: '', n: '1/min', f: 'mm' }, forms: ['L = l + l_a + l_u'] },
  { id: 'cuttingPower', area: 'metal', topic: 'cutting', show: 'P_c = F_c*v_c/60000', solve: 'P_c = F_c*v_c/60000', vars: { P_c: 'kW', F_c: 'N', v_c: 'm/min' } },
  /* ---------- metal: strength ---------- */
  { id: 'stress', area: 'metal', topic: 'strength', show: 'sigma = F/S', solve: 'sigma = F/S', vars: { sigma: 'N/mm²', F: 'N', S: 'mm²' } },
  { id: 'tensileStrength', area: 'metal', topic: 'strength', show: 'R_m = F_m/S_0', solve: 'R_m = F_m/S_0', vars: { R_m: 'N/mm²', F_m: 'N', S_0: 'mm²' } },
  { id: 'elongation', area: 'metal', topic: 'strength', show: 'epsilon = Δl/l_0*100', solve: 'epsilon = Δl/l_0*100', vars: { epsilon: '%', Δl: 'mm', l_0: 'mm' } },
  { id: 'hooke', area: 'metal', topic: 'strength', show: 'sigma = E*epsilon', solve: 'sigma = E*epsilon', vars: { sigma: 'N/mm²', E: 'N/mm²', epsilon: '' } },
  { id: 'allowable', area: 'metal', topic: 'strength', show: 'sigma_zul = R_e/nu', solve: 'sigma_zul = R_e/nu', vars: { sigma_zul: 'N/mm²', R_e: 'N/mm²', nu: '' } },
  { id: 'shear', area: 'metal', topic: 'strength', show: 'tau_a = F/S', solve: 'tau_a = F/S', vars: { tau_a: 'N/mm²', F: 'N', S: 'mm²' } },
  { id: 'mass', area: 'metal', topic: 'strength', show: 'm = V*rho', solve: 'm = V*rho', vars: { m: 'g', V: 'cm³', rho: 'g/cm³' } },
  /* ---------- metal: drives ---------- */
  { id: 'beltDrive', area: 'metal', topic: 'drives', show: 'd_1*n_1 = d_2*n_2', solve: 'd_1*n_1 = d_2*n_2', vars: { d_1: 'mm', n_1: '1/min', d_2: 'mm', n_2: '1/min' } },
  { id: 'ratio', area: 'metal', topic: 'drives', show: 'i = n_1/n_2', solve: 'i = n_1/n_2', vars: { i: '', n_1: '1/min', n_2: '1/min' }, forms: ['i = d_2/d_1', 'i = z_2/z_1'] },
  { id: 'gearDrive', area: 'metal', topic: 'drives', show: 'z_1*n_1 = z_2*n_2', solve: 'z_1*n_1 = z_2*n_2', vars: { z_1: '', n_1: '1/min', z_2: '', n_2: '1/min' } },
  { id: 'totalRatio', area: 'metal', topic: 'drives', show: 'i = i_1*i_2', solve: 'i = i_1*i_2', vars: { i: '', i_1: '', i_2: '' } },
  { id: 'powerTorque', area: 'metal', topic: 'drives', show: 'P = M*n/9550', solve: 'P = M*n/9550', vars: { P: 'kW', M: 'N·m', n: '1/min' }, forms: ['P = 2*pi*n*M'] },
  /* ---------- metal: gears ---------- */
  { id: 'pitchDiameter', area: 'metal', topic: 'gears', show: 'd = m*z', solve: 'd = m*z', vars: { d: 'mm', m: 'mm', z: '' } },
  { id: 'tipDiameter', area: 'metal', topic: 'gears', show: 'd_a = m*(z + 2)', solve: 'd_a = m*(z + 2)', vars: { d_a: 'mm', m: 'mm', z: '' } },
  { id: 'rootDiameter', area: 'metal', topic: 'gears', show: 'd_f = m*(z - 2.5)', solve: 'd_f = m*(z - 2.5)', vars: { d_f: 'mm', m: 'mm', z: '' } },
  { id: 'toothHeight', area: 'metal', topic: 'gears', show: 'h = 2.25*m', solve: 'h = 2.25*m', vars: { h: 'mm', m: 'mm' } },
  { id: 'circularPitch', area: 'metal', topic: 'gears', show: 'p = pi*m', solve: 'p = pi*m', vars: { p: 'mm', m: 'mm' } },
  { id: 'centerDistance', area: 'metal', topic: 'gears', show: 'a = m*(z_1 + z_2)/2', solve: 'a = m*(z_1 + z_2)/2', vars: { a: 'mm', m: 'mm', z_1: '', z_2: '' } },
  /* ---------- metal: fits and tolerances ---------- */
  { id: 'tolerance', area: 'metal', topic: 'fits', show: 'T = G_o - G_u', solve: 'T = G_o - G_u', vars: { T: 'mm', G_o: 'mm', G_u: 'mm' } },
  { id: 'maxClearance', area: 'metal', topic: 'fits', show: 'P_SH = G_oB - G_uW', solve: 'P_SH = G_oB - G_uW', vars: { P_SH: 'mm', G_oB: 'mm', G_uW: 'mm' } },
  { id: 'minClearance', area: 'metal', topic: 'fits', show: 'P_SM = G_uB - G_oW', solve: 'P_SM = G_uB - G_oW', vars: { P_SM: 'mm', G_uB: 'mm', G_oW: 'mm' } },
  /* ---------- metal: shapes ---------- */
  { id: 'taper', area: 'metal', topic: 'shapes', show: 'C = (D - d)/L', solve: 'C = (D - d)/L', vars: { C: '', D: 'mm', d: 'mm', L: 'mm' } },
  { id: 'taperAngle', area: 'metal', topic: 'shapes', show: 'tan(alpha/2) = (D - d)/(2*L)', solve: 'tan(alpha/2) = (D - d)/(2*L)', vars: { alpha: '°', D: 'mm', d: 'mm', L: 'mm' }, angle: 'deg' },

  /* ---------- pneumatics ---------- */
  { id: 'absolutePressure', area: 'fluid', topic: 'pneumatics', show: 'p_abs = p_e + p_amb', solve: 'p_abs = p_e + p_amb', vars: { p_abs: 'bar', p_e: 'bar', p_amb: { unit: 'bar', value: 1.013 } } },
  { id: 'pistonArea', area: 'fluid', topic: 'pneumatics', show: 'A = pi*d^2/4', solve: 'A = pi*d^2/4', vars: { A: 'cm²', d: 'cm' }, forms: ['A_R = pi*(D^2 - d^2)/4'] },
  { id: 'pistonForce', area: 'fluid', topic: 'pneumatics', show: 'F = 10*p_e*A*eta', solve: 'F = 10*p_e*A*eta', vars: { F: 'N', p_e: 'bar', A: 'cm²', eta: '' } },
  { id: 'airConsumption', area: 'fluid', topic: 'pneumatics', show: 'Q = A*s*n*(p_e + p_amb)/p_amb', solve: 'Q = A*s*n*(p_e + p_amb)/p_amb', vars: { Q: 'cm³/min', A: 'cm²', s: 'cm', n: '1/min', p_e: 'bar', p_amb: { unit: 'bar', value: 1.013 } } },
  { id: 'boyle', area: 'fluid', topic: 'pneumatics', show: 'p_1*V_1 = p_2*V_2', solve: 'p_1*V_1 = p_2*V_2', vars: { p_1: 'bar', V_1: 'l', p_2: 'bar', V_2: 'l' } },
  /* ---------- hydraulics ---------- */
  { id: 'hydraulicPress', area: 'fluid', topic: 'hydraulics', show: 'F_1/A_1 = F_2/A_2', solve: 'F_1/A_1 = F_2/A_2', vars: { F_1: 'N', A_1: 'cm²', F_2: 'N', A_2: 'cm²' }, forms: ['s_1*A_1 = s_2*A_2'] },
  { id: 'pistonSpeed', area: 'fluid', topic: 'hydraulics', show: 'v = Q/A', solve: 'v = Q/A', vars: { v: 'm/s', Q: 'm³/s', A: 'm²' } },
  { id: 'continuity', area: 'fluid', topic: 'hydraulics', show: 'A_1*v_1 = A_2*v_2', solve: 'A_1*v_1 = A_2*v_2', vars: { A_1: 'cm²', v_1: 'm/s', A_2: 'cm²', v_2: 'm/s' } },
  { id: 'hydraulicPower', area: 'fluid', topic: 'hydraulics', show: 'P = p*Q', solve: 'P = p*Q', vars: { P: 'W', p: 'Pa', Q: 'm³/s' } },

  /* ---------- chemistry ---------- */
  { id: 'amount', area: 'chemistry', topic: 'amount', show: 'n = m/M', solve: 'n = m/M', vars: { n: 'mol', m: 'g', M: 'g/mol' } },
  { id: 'particles', area: 'chemistry', topic: 'amount', show: 'N = n*N_A', solve: 'N = n*N_A', vars: { N: '', n: 'mol', N_A: { unit: '1/mol', value: 6.02214076e23 } } },
  { id: 'molarVolume', area: 'chemistry', topic: 'amount', show: 'V = n*V_m', solve: 'V = n*V_m', vars: { V: 'l', n: 'mol', V_m: { unit: 'l/mol', value: 22.414 } } },
  { id: 'idealGas', area: 'chemistry', topic: 'amount', show: 'p*V = n*R*T', solve: 'p*V = n*R*T', vars: { p: 'Pa', V: 'm³', n: 'mol', R: { unit: 'J/(mol·K)', value: 8.314 }, T: 'K' } },
  { id: 'concentration', area: 'chemistry', topic: 'solutions', show: 'c = n/V', solve: 'c = n/V', vars: { c: 'mol/l', n: 'mol', V: 'l' } },
  { id: 'massFraction', area: 'chemistry', topic: 'solutions', show: 'w = m_i/m*100', solve: 'w = m_i/m*100', vars: { w: '%', m_i: 'g', m: 'g' } },
  { id: 'ph', area: 'chemistry', topic: 'solutions', show: 'pH = -lg(c)', solve: 'pH = -lg(c)', vars: { pH: '', c: 'mol/l' }, forms: ['c = 10^(-pH)', 'pH + pOH = 14'] },
]

/* Constants: defined (exact) or the values school books use. */
export const CONSTANTS = [
  { id: 'g', show: 'g', value: '9.81', unit: 'N/kg = m/s²' },
  { id: 'c', show: 'c', value: '299 792 458', unit: 'm/s' },
  { id: 'NA', show: 'N_A', value: '6.022 140 76 · 10²³', unit: '1/mol' },
  { id: 'e', show: 'e', value: '1.602 176 634 · 10⁻¹⁹', unit: 'C' },
  { id: 'R', show: 'R', value: '8.314', unit: 'J/(mol·K)' },
  { id: 'Vm', show: 'V_m', value: '22.414', unit: 'l/mol' },
  { id: 'cWater', show: 'c_W', value: '4.19', unit: 'kJ/(kg·K)' },
  { id: 'rhoWater', show: 'rho_W', value: '1.00', unit: 'g/cm³' },
  { id: 'pAmb', show: 'p_amb', value: '1.013', unit: 'bar' },
  { id: 'zero', show: '0 K', value: '−273.15', unit: '°C' },
  { id: 'bar', show: '1 bar', value: '10⁵ Pa = 10 N/cm²', unit: '' },
  { id: 'kwh', show: '1 kWh', value: '3.6 · 10⁶', unit: 'J' },
  { id: 'ps', show: '1 PS', value: '735.5', unit: 'W' },
]
