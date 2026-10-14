// 文件语言/类型图标：Material Icon Theme 的 46 个素材逐名内联（`?raw`），
// 与 ProviderIcon 走同一条通道（不引运行时、不落 public、dev 与打包一致）。
// 素材自带品牌色，所以**不加 mask 反白**——与提供方图标那套单色处理不同。
// Record<FileIconName, string> 是穷举：fileIcons.ts 里能算出的名字漏了素材，
// 这里就类型报错。
import audioSvg from "material-icon-theme/icons/audio.svg?raw";
import consoleSvg from "material-icon-theme/icons/console.svg?raw";
import cssSvg from "material-icon-theme/icons/css.svg?raw";
import databaseSvg from "material-icon-theme/icons/database.svg?raw";
import dockerSvg from "material-icon-theme/icons/docker.svg?raw";
import documentSvg from "material-icon-theme/icons/document.svg?raw";
import gitSvg from "material-icon-theme/icons/git.svg?raw";
import goSvg from "material-icon-theme/icons/go.svg?raw";
import htmlSvg from "material-icon-theme/icons/html.svg?raw";
import imageSvg from "material-icon-theme/icons/image.svg?raw";
import javaSvg from "material-icon-theme/icons/java.svg?raw";
import javascriptSvg from "material-icon-theme/icons/javascript.svg?raw";
import jsonSvg from "material-icon-theme/icons/json.svg?raw";
import kotlinSvg from "material-icon-theme/icons/kotlin.svg?raw";
import lessSvg from "material-icon-theme/icons/less.svg?raw";
import licenseSvg from "material-icon-theme/icons/license.svg?raw";
import lockSvg from "material-icon-theme/icons/lock.svg?raw";
import makefileSvg from "material-icon-theme/icons/makefile.svg?raw";
import markdownSvg from "material-icon-theme/icons/markdown.svg?raw";
import nodejsSvg from "material-icon-theme/icons/nodejs.svg?raw";
import pdfSvg from "material-icon-theme/icons/pdf.svg?raw";
import phpSvg from "material-icon-theme/icons/php.svg?raw";
import pnpmSvg from "material-icon-theme/icons/pnpm.svg?raw";
import powerpointSvg from "material-icon-theme/icons/powerpoint.svg?raw";
import pythonSvg from "material-icon-theme/icons/python.svg?raw";
import reactSvg from "material-icon-theme/icons/react.svg?raw";
import reactTsSvg from "material-icon-theme/icons/react_ts.svg?raw";
import readmeSvg from "material-icon-theme/icons/readme.svg?raw";
import rubySvg from "material-icon-theme/icons/ruby.svg?raw";
import rustSvg from "material-icon-theme/icons/rust.svg?raw";
import sassSvg from "material-icon-theme/icons/sass.svg?raw";
import stylusSvg from "material-icon-theme/icons/stylus.svg?raw";
import svgSvg from "material-icon-theme/icons/svg.svg?raw";
import swiftSvg from "material-icon-theme/icons/swift.svg?raw";
import tableSvg from "material-icon-theme/icons/table.svg?raw";
import tomlSvg from "material-icon-theme/icons/toml.svg?raw";
import tsconfigSvg from "material-icon-theme/icons/tsconfig.svg?raw";
import typescriptSvg from "material-icon-theme/icons/typescript.svg?raw";
import videoSvg from "material-icon-theme/icons/video.svg?raw";
import viteSvg from "material-icon-theme/icons/vite.svg?raw";
import vueSvg from "material-icon-theme/icons/vue.svg?raw";
import wordSvg from "material-icon-theme/icons/word.svg?raw";
import xmlSvg from "material-icon-theme/icons/xml.svg?raw";
import yamlSvg from "material-icon-theme/icons/yaml.svg?raw";
import yarnSvg from "material-icon-theme/icons/yarn.svg?raw";
import zipSvg from "material-icon-theme/icons/zip.svg?raw";
import { resolveFileIconName, type FileIconName } from "./fileIcons";

const ICON_SVG: Record<FileIconName, string> = {
  audio: audioSvg, console: consoleSvg, css: cssSvg, database: databaseSvg,
  docker: dockerSvg, document: documentSvg, git: gitSvg, go: goSvg,
  html: htmlSvg, image: imageSvg, java: javaSvg, javascript: javascriptSvg,
  json: jsonSvg, kotlin: kotlinSvg, less: lessSvg, license: licenseSvg,
  lock: lockSvg, makefile: makefileSvg, markdown: markdownSvg, nodejs: nodejsSvg,
  pdf: pdfSvg, php: phpSvg, pnpm: pnpmSvg, powerpoint: powerpointSvg,
  python: pythonSvg, react: reactSvg, react_ts: reactTsSvg, readme: readmeSvg,
  ruby: rubySvg, rust: rustSvg, sass: sassSvg, stylus: stylusSvg,
  svg: svgSvg, swift: swiftSvg, table: tableSvg, toml: tomlSvg,
  tsconfig: tsconfigSvg, typescript: typescriptSvg, video: videoSvg, vite: viteSvg,
  vue: vueSvg, word: wordSvg, xml: xmlSvg, yaml: yamlSvg,
  yarn: yarnSvg, zip: zipSvg,
};

/** 文件行前导图标（默认 14，与工具行其他前导 glyph 同尺寸）。装饰性：文件名
 *  就在旁边，故 aria-hidden。`icon` 是给**类型已知**的调用方用的（附件的图片部件
 *  就是图片）：名字没有扩展名时（粘贴来的图）图标才不会掉成通用文件。 */
export function FileIcon({ file, size = 14, icon }: { file: string; size?: number; icon?: FileIconName }) {
  return (
    <span
      className="file-icon"
      style={{ width: size, height: size }}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICON_SVG[icon ?? resolveFileIconName(file)] }}
    />
  );
}
