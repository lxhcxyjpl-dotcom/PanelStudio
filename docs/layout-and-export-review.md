# 排版与导出 · 第二批实机记录

本次接续第一批 `01d21e6`；改动为 10、11、12、14。06 新手引导、13 AI 连接、15 项目库留待单独评审。

| 序号 | 在编辑器中可以看到什么 |
| --- | --- |
| 10 排版目标 | 图稿重点只问一次；期刊和领域仍能填写；四个偏好使用短标签。 |
| 11 参考图与偏好 | 默认两个入口：选择参考图、写偏好。折叠的手动设置显示实际会采用的值；没有识别的短语需要用户处理。 |
| 12 候选版式 | 用相同六张图比较两行三图、三行两图、每行 3/2/1 图。缩略图保持实际宽高比。应用、保留并返回编辑、丢弃是三个独立操作。 |
| 14 导出 | 格式与字体说明默认折叠；未应用草案时显示导出版本；PNG 显示 DPI 和对应的像素尺寸。切换格式后，上一次其他格式的下载结果不会混入当前选项。 |

[22 秒操作实录](demo/layout-review.mp4)使用同一组六张合成科研面板，录下偏好输入、切换版式、保留并返回、导出版本 0、应用版式并导出版本 1。下面的截图均来自正在运行的本地工作台。

| 视窗 | 改前 | 改后 |
| --- | --- | --- |
| 桌面 1440 × 900 | [原图](screenshots/editorial/candidates-before-desktop.png) | [原图](screenshots/editorial/candidates-second-desktop.png) |
| 手机 390 × 844 | [原图](screenshots/editorial/candidates-before-mobile.png) | [原图](screenshots/editorial/candidates-second-mobile.png) |

验证：Windows 本地，179 项单元测试、53 项 Chromium 浏览器回归通过，九个包/应用类型检查与生产构建通过。浏览器实际下载了 SVG、PNG 和工程包；核对 SVG 内部修订号、PNG 文件头尺寸与同一修订的预估值。保留、取消和丢弃未写入原稿，应用新增一个修订。界面保留 13 / 15 / 24 / 56 px 四档字号，图稿内部的科学标注独立。手机证据来自 Chromium 窄视窗。[验收数值与文件校验值](acceptance-editorial/second-pass.json)。

复现截图和录制（先启动隔离的本地预览；录像需要 Playwright 的 FFmpeg）：

~~~powershell
node scripts/local-preview.mjs test-results/review-demo-db
# 另开一个终端
node scripts/capture-layout-review.mjs http://127.0.0.1:5283 test-results/review-capture --video
~~~
