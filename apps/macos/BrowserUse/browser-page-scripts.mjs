// 页面侧的脚本片段：在浏览器的页面上下文里执行（壳的 evaluate 原语发过来的字符串）。
// 移植 ZCode browser-use 的观察纪律——**快照优先、ref 定位、动作后重新观察**——但快照
// 实现是本仓自己的：ZCode 用 Playwright 的 injected script 生成 ARIA 树，这里用一段
// 简化 walker（角色推断 + 可访问名 + 可见性过滤），ref 通过 data-dd-ref 属性落回元素。
//
// 这些脚本必须是**自求值表达式**（evaluate 只回一个 JSON 值），所以每个都是一段 IIFE。


/** 角色推断的**唯一实现**：快照与定位器都用它。曾经两处各写一份，定位器那份漏了
 *  heading 映射，于是"快照里明明有 r1 heading"却 getByRole("heading") 匹配不到。 */
const ROLE_FN = `(el) => {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === 'a') return el.hasAttribute('href') ? 'link' : 'generic';
  if (tag === 'button') return 'button';
  if (tag === 'select') return 'combobox';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'img') return 'img';
  if (tag === 'li') return 'listitem';
  if (tag === 'form') return 'form';
  if (tag === 'label') return 'label';
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (tag === 'input') {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'submit' || type === 'button' || type === 'reset') return 'button';
    if (type === 'range') return 'slider';
    return 'textbox';
  }
  return 'generic';
}`;

/** 可访问名（快照与定位器共用同一份口径）。 */
const NAME_FN = `(el) => {
  const label = el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('placeholder');
  if (label) return label.trim().slice(0, 90);
  return (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 90);
}`;

/** 快照：给可见的交互元素编号并把紧凑树拼成文本（ZCode domSnapshot 的等价物）。 */
export const SNAPSHOT = `(() => {
  document.querySelectorAll('[data-dd-ref]').forEach((e) => e.removeAttribute('data-dd-ref'));
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  };
  const roleOf = ${ROLE_FN};
  const nameOf = ${NAME_FN};
  const selector = 'a,button,input,select,textarea,[role],[contenteditable="true"],h1,h2,h3,h4,h5,h6,li,img,form,label';
  const lines = [];
  let n = 0;
  for (const el of document.querySelectorAll(selector)) {
    if (lines.length >= 300) { lines.push('… (truncated at 300 elements)'); break; }
    if (!visible(el)) continue;
    const ref = 'r' + (++n);
    el.setAttribute('data-dd-ref', ref);
    const state = [];
    if (el.disabled) state.push('disabled');
    if (el.checked) state.push('checked');
    const value = (el.value || '').trim();
    if (value) state.push('value="' + value.slice(0, 40) + '"');
    const suffix = state.length ? ' [' + state.join(', ') + ']' : '';
    lines.push(ref + ' ' + roleOf(el) + ' "' + nameOf(el) + '"' + suffix);
  }
  return lines.join('\\n') || '(no interactive elements)';
})()`;

/** ref 元素的存在性（动作前的便宜检查）。 */
export const refCount = (ref) =>
  `document.querySelectorAll('[data-dd-ref="${ref}"]').length`;

/** ref → 点击（快照证明过的元素不需要额外角色判定；先聚焦再点）。 */
export const clickRef = (ref) => `(() => {
  const el = document.querySelector('[data-dd-ref="${ref}"]');
  if (!el) return 'ref_not_found';
  el.scrollIntoView({ block: 'center' });
  if (el.focus) el.focus();
  el.click();
  return 'ok';
})()`;

/** 坐标点击（快照看不见的 canvas/自绘件走这条；用命中元素派发一次真实 MouseEvent 序列）。 */
export const clickPoint = (x, y) => `(() => {
  const el = document.elementFromPoint(${x}, ${y});
  if (!el) return 'no element at ' + ${x} + ',' + ${y};
  const opts = { bubbles: true, cancelable: true, clientX: ${x}, clientY: ${y}, view: window };
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));
  return 'ok';
})()`;

/** ref → 填入（清空后写值并派发 input/change，框架才看得到）。 */
export const fillRef = (ref, text) => `(() => {
  const el = document.querySelector('[data-dd-ref="${ref}"]');
  if (!el) return 'ref_not_found';
  el.focus();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value');
  if (setter && setter.set) setter.set.call(el, ${JSON.stringify(text)});
  else el.value = ${JSON.stringify(text)};
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`;

/** 追加输入（不清空）。 */
export const typeRef = (ref, text) => `(() => {
  const el = document.querySelector('[data-dd-ref="${ref}"]');
  if (!el) return 'ref_not_found';
  el.focus();
  for (const ch of ${JSON.stringify(text)}) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
    el.value = (el.value || '') + ch;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
  }
  return 'ok';
})()`;

/** 按键（Enter/Tab/Escape/组合键）。 */
export const pressKeys = (keys) => `(() => {
  const el = document.activeElement || document.body;
  const parts = ${JSON.stringify(keys)}.split('+');
  const key = parts.pop();
  const opts = { key, bubbles: true, cancelable: true,
    ctrlKey: parts.includes('Control'), shiftKey: parts.includes('Shift'),
    altKey: parts.includes('Alt'), metaKey: parts.includes('Meta') || parts.includes('Cmd') };
  el.dispatchEvent(new KeyboardEvent('keydown', opts));
  el.dispatchEvent(new KeyboardEvent('keyup', opts));
  if (key === 'Enter' && el.form && typeof el.form.requestSubmit === 'function') el.form.requestSubmit();
  return 'ok';
})()`;

/** 选择框取值。 */
export const selectRef = (ref, value) => `(() => {
  const el = document.querySelector('[data-dd-ref="${ref}"]');
  if (!el) return 'ref_not_found';
  el.value = ${JSON.stringify(value)};
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`;

/** 勾选/取消勾选。 */
export const setChecked = (ref, checked) => `(() => {
  const el = document.querySelector('[data-dd-ref="${ref}"]');
  if (!el) return 'ref_not_found';
  if (el.checked !== ${checked}) el.click();
  return 'ok';
})()`;

/** 滚动（页面级或元素内）。 */
export const scrollBy = (dx, dy) => `(() => { window.scrollBy(${dx}, ${dy}); return 'ok'; })()`;

/** 定位器：按角色+名字、文本、标签、testid 或选择器找元素，可选执行一个动作。 */
export function locatorScript(kind, value, action, argument) {
  const matcher = {
    role: `(el) => { const role = (${ROLE_FN})(el).toLowerCase();
      const name = (${NAME_FN})(el);
      return role === ${JSON.stringify(String(value).toLowerCase())} && (!${JSON.stringify(String(argument ?? ""))} || name.includes(${JSON.stringify(String(argument ?? ""))})); }`,
    text: `(el) => ((el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim()).includes(${JSON.stringify(String(value))})`,
    label: `(el) => (el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').includes(${JSON.stringify(String(value))})`,
    testid: `(el) => el.getAttribute('data-testid') === ${JSON.stringify(String(value))}`,
    selector: `(el) => el.matches(${JSON.stringify(String(value))})`,
  }[kind];
  const act = {
    count: 'return String(found.length);',
    click: 'if (found.length !== 1) return "strict_violation: " + found.length; found[0].scrollIntoView({block:"center"}); found[0].click(); return "ok";',
    fill: `if (found.length !== 1) return "strict_violation: " + found.length;
           found[0].focus(); found[0].value = ${JSON.stringify(String(argument ?? ''))};
           found[0].dispatchEvent(new Event('input', { bubbles: true }));
           found[0].dispatchEvent(new Event('change', { bubbles: true })); return "ok";`,
    press: `if (found.length !== 1) return "strict_violation: " + found.length;
            found[0].focus();
            found[0].dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(String(argument ?? 'Enter'))}, bubbles: true }));
            found[0].dispatchEvent(new KeyboardEvent('keyup', { key: ${JSON.stringify(String(argument ?? 'Enter'))}, bubbles: true }));
            return "ok";`,
    textContent: 'if (found.length !== 1) return "strict_violation: " + found.length; return found[0].textContent || "";',
    innerText: 'if (found.length !== 1) return "strict_violation: " + found.length; return found[0].innerText || "";',
    isVisible: 'if (found.length !== 1) return "strict_violation: " + found.length; const r = found[0].getBoundingClientRect(); return String(r.width > 0 && r.height > 0);',
    isEnabled: 'if (found.length !== 1) return "strict_violation: " + found.length; return String(!found[0].disabled);',
    getAttribute: `if (found.length !== 1) return "strict_violation: " + found.length; return String(found[0].getAttribute(${JSON.stringify(String(argument ?? ''))}));`,
  }[action] ?? 'return "unknown action: ' + action + '";';
  return `(() => {
    const all = Array.from(document.querySelectorAll('*'));
    const found = all.filter(${matcher});
    ${act}
  })()`;
}

/** 等待页面出现某段文本（ZCode 的 waitFor 语义：可观察状态优先）。 */
export const waitForText = (text) =>
  `(() => { const body = (document.body.innerText || ''); return String(body.includes(${JSON.stringify(text)})); })()`;

/** 等待加载状态：domcontentloaded 已过（本仓只支持这一档，ZCode 也禁 networkidle）。 */
export const READY_STATE = `String(document.readyState !== 'loading')`;
