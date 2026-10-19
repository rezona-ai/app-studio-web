'use client';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import { selectModelGateLocked, selectModelSelectorLocked } from '@/store/selectors';
import { BASE_MODEL } from '@/lib/subscription/model-gate';
import Select from '@/components/ui/Select';
import { figAsset } from '@/components/ui/figma';
import { modelLabel, modelMeta, type ModelBrand } from '@/lib/koubou/models';
import { track } from '@/lib/analytics';
import type { KoubouClient } from '@/koubou/client';

// 对话输入区模型选择器(Figma 424:3595 / 33:463):复用公共 Select(plain 变体,与 +/@ 工具栏一致),
// 选择写持久化(setSelectedModel)并发 session.set_model 热切换(不重连)。
// 选项参考官方带图标 + 定位文案:图标按品牌取各家官方字形(Anthropic 官方不区分模型字形,统一星芒),
// 文案取各家官方的模型定位描述(chat.modelDesc.*);未知模型回退为纯名称行。
const BRAND_ICON: Record<ModelBrand, string> = {
  rezona: figAsset.logo, // 自研模型暂用项目 logo 占位,待专属字形出稿再换
  claude: figAsset.modelClaude,
  openai: figAsset.modelOpenai,
  grok: figAsset.modelGrok,
  seed: figAsset.modelSeed,
  kimi: figAsset.modelKimi,
  glm: figAsset.modelGlm,
};
export default function ModelSelector({ client }: { client: React.RefObject<KoubouClient | null> }) {
  const { t } = useTranslation();
  const models = useStore((s) => s.availableModels);
  const selected = useStore((s) => s.selectedModel);
  const setSelectedModel = useStore((s) => s.setSelectedModel);
  // codex 活跃 run 期禁用(判据与报错气泡的 Switch model 共用,见 selector 注释)
  const locked = useStore(selectModelSelectorLocked);
  // 新用户门禁:锁定态下只允许 Rez1,点别的模型不切换、直接开订阅弹窗
  // (spec 2026-08-28-new-user-model-gate-design;选项外观不变,定案不加锁标)
  const gated = useStore(selectModelGateLocked);
  const setCreditModalOpen = useStore((s) => s.setCreditModalOpen);
  // 报错气泡的 Switch model 按钮只碰 store,菜单由这里按计数展开(设计稿 2026-09-03)
  const openRequest = useStore((s) => s.modelMenuRequest);

  // 无可选模型(未加载 / 拉取失败)不渲染
  if (models.length === 0 || !selected) return null;

  return (
    <Select
      value={selected}
      options={models.map((id) => {
        const meta = modelMeta(id);
        return {
          value: id,
          label: modelLabel(id),
          icon: meta ? BRAND_ICON[meta.brand] : undefined,
          description: meta?.desc ? t(`chat.modelDesc.${meta.desc}`) : undefined,
        };
      })}
      onChange={(id) => {
        if (gated && id !== BASE_MODEL) {
          setCreditModalOpen('modelLocked');
          return;   // 不写 selectedModel、不发 session.set_model —— 后端不拦(premium_models 无强制),锁全靠这一层
        }
        if (id !== selected) track('model_switch', { model_from: selected, model_to: id }); // 仅切换实际发生(id 不同)才上报,重选同项不算切换
        setSelectedModel(id);
        client.current?.setModel(id);
      }}
      align="right"
      variant="plain"
      disabled={locked}
      openRequest={openRequest}
      ariaLabel={t('chat.modelNamed', { name: modelLabel(selected) })}
    />
  );
}
