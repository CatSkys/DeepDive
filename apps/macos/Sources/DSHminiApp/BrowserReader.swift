// 阅读模式：把页面换成"只有正文"的那一版。
//
// 难的是判断正文是哪一块。这里用的是老办法（参考实现 Search 的 `Reader.swift`，同一套）：
// **谁的散文最多谁就是正文，且为里面的每个链接扣分**——导航条、相关阅读、评论区都是链接堆的，
// 散文不是。
//
// 变换是**在页面里做的**（不是把正文抓出来另画一版）：新建一个 `#office-reader`，把正文节点的
// innerHTML 搬进去，配一份自带的样式，再把 body 换成它。因此退出阅读模式 = 重新加载（页面已经
// 被换过了，没有"原来的 DOM"可回）。
//
// 图片必须在**原页面还站着的时候**解析：`currentSrc` 是浏览器按 srcset/sizes/picture 真选中的那个，
// 只抄 markdown 会拿到懒加载占位图。
import WebKit

enum BrowserReader {
    /// 跑一次阅读模式。回 `read`（换好了）或 `none`（没找到正文）。
    static func enter(_ host: BrowserHost, completion: @escaping (String) -> Void) {
        host.evaluate(script) { text in
            host.readerOn = (text == "read")
            host.publish()
            completion(text)
        }
    }

    /// 退出阅读模式：只能重载（身体已经被换过了）。
    static func exit(_ host: BrowserHost) {
        host.readerOn = false
        host.reload()
    }

    private static let script = """
    (function () {
      function prose(el) {
        var paragraphs = el.querySelectorAll('p');
        if (paragraphs.length < 2) return 0;
        var letters = 0;
        for (var i = 0; i < paragraphs.length; i++) {
          letters += (paragraphs[i].innerText || '').length;
        }
        if (letters < 400) return 0;
        // 一堆相关阅读的链接也有大把文字，但没东西可读
        var links = el.querySelectorAll('a').length;
        return letters / (1 + links * 14);
      }

      function best() {
        var candidates = document.querySelectorAll(
          'article, main, [role="main"], .post, .entry, .article, .content, #content, div, section'
        );
        var top = null, mark = 0;
        for (var i = 0; i < candidates.length; i++) {
          var score = prose(candidates[i]);
          if (score > mark) { mark = score; top = candidates[i]; }
        }
        return top;
      }

      var article = best();
      if (!article) return 'none';

      // 每张图趁原页面还站着解析成普通 src（懒加载的占位图在这一步现出原形）
      var late = ['data-src', 'data-original', 'data-lazy-src', 'data-lazy',
                  'data-full-src', 'data-hi-res-src', 'data-image', 'data-echo'];
      var pictures = article.querySelectorAll('img');
      for (var i = 0; i < pictures.length; i++) {
        var picture = pictures[i];
        picture.setAttribute('loading', 'eager');
        var real = picture.currentSrc || picture.getAttribute('src') || '';
        if (!real || real.indexOf('data:image') === 0 || picture.naturalWidth <= 2) {
          for (var k = 0; k < late.length; k++) {
            var kept = picture.getAttribute(late[k]);
            if (kept) { real = kept; break; }
          }
        }
        if (real) picture.setAttribute('src', real);
        var lateSet = picture.getAttribute('data-srcset');
        if (lateSet && !picture.getAttribute('srcset')) {
          picture.setAttribute('srcset', lateSet);
        }
      }

      // 标题：h1 优先，但 h1 里带链接的（维基那种"标题 + 编辑"）会混进链接文字，
      // 那时退回 document.title（实测：维基的 h1 innerText 是"WebKit编辑"）
      var heading = document.querySelector('h1');
      var clean = heading && heading.querySelectorAll('a').length === 0 ? heading.innerText.trim() : '';
      var title = clean || document.title;

      var sheet = document.createElement('style');
      sheet.textContent = [
        'html,body{background:#fff !important;margin:0 !important;padding:0 !important}',
        '#deepdive-reader{max-width:38em;margin:0 auto;padding:72px 24px 160px;',
        'font:400 18px/1.72 ui-serif,Georgia,"Times New Roman",serif;color:#171717}',
        '#deepdive-reader h1{font:600 30px/1.24 -apple-system,BlinkMacSystemFont,sans-serif;',
        'margin:0 0 8px;letter-spacing:-0.01em}',
        '#deepdive-reader .deepdive-from{font:400 12px/1 -apple-system,sans-serif;color:#a3a3a3;',
        'margin:0 0 40px;text-transform:uppercase;letter-spacing:.06em}',
        '#deepdive-reader p{margin:0 0 1.35em}',
        '#deepdive-reader img,#deepdive-reader video,#deepdive-reader iframe{max-width:100%;',
        'height:auto;border-radius:6px;margin:1.6em 0;display:block}',
        '#deepdive-reader iframe{width:100%;aspect-ratio:16/9;height:auto;border:0}',
        '#deepdive-reader figure{margin:1.8em 0}',
        '#deepdive-reader figcaption{font:400 13px/1.5 -apple-system,sans-serif;',
        'color:#a3a3a3;margin-top:.6em}',
        '#deepdive-reader a{color:#171717;text-underline-offset:3px}',
        '#deepdive-reader h2,#deepdive-reader h3{font:600 20px/1.3 -apple-system,sans-serif;',
        'margin:2em 0 .6em}',
        '#deepdive-reader pre,#deepdive-reader code{font-family:ui-monospace,monospace;font-size:14px}',
        '#deepdive-reader pre{background:#f5f5f5;padding:14px;border-radius:8px;overflow:auto}',
        '#deepdive-reader blockquote{margin:1.6em 0;padding-left:1.2em;',
        'border-left:2px solid #e8e8e8;color:#555}'
      ].join('');

      var wrap = document.createElement('div');
      wrap.id = 'deepdive-reader';
      wrap.innerHTML = article.innerHTML;

      // 围着字摆的东西不是字（header 不动：正文的首图常常在那儿）
      var clutter = wrap.querySelectorAll(
        'script,style,noscript,form,nav,aside,footer,button,input,select,textarea,' +
        '[role="complementary"],[role="navigation"],[role="banner"],[aria-hidden="true"]'
      );
      for (var c = 0; c < clutter.length; c++) clutter[c].remove();

      // 嵌入的视频是正文的一部分，别的框不是
      var players = /youtube|youtu\\.be|vimeo|dailymotion|loom\\.com|streamable|wistia|ted\\.com/i;
      var frames = wrap.querySelectorAll('iframe');
      for (var f = 0; f < frames.length; f++) {
        var where = frames[f].getAttribute('src') || frames[f].getAttribute('data-src') || '';
        if (players.test(where)) {
          frames[f].setAttribute('src', where);
          frames[f].removeAttribute('height');
          frames[f].removeAttribute('width');
        } else {
          frames[f].remove();
        }
      }

      // 背后什么都没有的图就是一张破图标，比没有图更糟
      var kept = wrap.querySelectorAll('img');
      for (var g = 0; g < kept.length; g++) {
        var src = kept[g].getAttribute('src') || '';
        if (!src || src.indexOf('data:image') === 0) kept[g].remove();
      }

      var top = document.createElement('h1');
      top.textContent = title;
      var from = document.createElement('p');
      from.className = 'deepdive-from';
      from.textContent = location.host.replace(/^www\\./, '');

      document.body.innerHTML = '';
      document.head.appendChild(sheet);
      wrap.insertBefore(from, wrap.firstChild);
      wrap.insertBefore(top, wrap.firstChild);
      document.body.appendChild(wrap);
      window.scrollTo(0, 0);
      return 'read';
    })();
    """
}
