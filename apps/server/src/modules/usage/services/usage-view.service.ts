import { DefaultUsageView, UsageView } from '@favo/domain/usage/usage-view';
import type { ConfigRepository } from '@/modules/system/repositories/config.repository';

export class UsageViewService {
  constructor(private readonly config: ConfigRepository) {}

  async read() {
    const parsed = UsageView.safeParse(await this.config.usageView().catch(() => undefined));
    return parsed.success ? parsed.data : DefaultUsageView;
  }

  async save(view: UsageView) {
    await this.config.saveUsageView(view);
    return view;
  }
}
