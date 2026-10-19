// 居中提示层(空态/失败态):单预览(GameFrame)、对比(CompareView)与全屏页(FullscreenPreview)共用。
// 单独成文件而非挂在 GameFrame 上:全屏页是独立文档,不该为一个提示层把 store 拖进它的首屏 chunk。
export default function ScreenNotice({ text }: { text: string }) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-[var(--color-fill)] px-4 text-center text-[12px] font-medium tracking-[-0.12px] text-[var(--color-muted)]">
      {text}
    </div>
  );
}
