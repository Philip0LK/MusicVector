import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins:[react()],
  // 曲库、凭据、运行环境和验收副本由产品服务管理，不参与源码热更新。
  // 排除这些目录，避免连续 UI 验收时监听数万份历史文件而拖慢页面加载。
  server:{watch:{ignored:['**/qa/**','**/runtime/**','**/data/**','**/private/**','**/local/fixtures/**','**/releases/**']}},
  build:{rollupOptions:{input:{main:'index.html',correction:'correction.html'}}}
});
