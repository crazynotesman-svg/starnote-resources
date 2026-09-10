/**
 * 环境变量规范化（下划线开头，不会生成路由）
 *
 * 在 Cloudflare 控制台粘贴变量值时，极易在末尾带上换行或空格。
 * GITHUB_REPO 带换行只是靠 URL 解析器吞掉换行才侥幸可用；
 * ADMIN_TOKEN 一旦带换行，safeEqual 永远不相等，表现为"口令不正确"，极难排查。
 *
 * 这里统一 trim。注意与领域约束的区别：资料口令（code 字段）绝不 trim，
 * 只清理环境变量，二者不可混淆。
 */

const TRIM_KEYS = ['ADMIN_TOKEN', 'GITHUB_TOKEN', 'GITHUB_REPO', 'GITHUB_BRANCH', 'GITHUB_PATH'];

export function normEnv(rawEnv) {
  const env = Object.assign({}, rawEnv);
  const dirty = [];

  for (const k of TRIM_KEYS) {
    const v = env[k];
    if (typeof v === 'string') {
      const t = v.trim();
      if (t !== v) dirty.push(k);
      env[k] = t;
    }
  }

  return { env, dirty };
}
