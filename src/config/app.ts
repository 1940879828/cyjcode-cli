/**
 * 应用级命名配置（统一入口）。
 * 项目所有运行时用到的名字集中在这里，改一处全局生效。
 */
export const APP = {
  /** 展示名（UI 文案用） */
  name: "tigacode-cli",
  /** 用户配置目录名（~/.tigacode） */
  configDirName: ".tigacode",
} as const;
