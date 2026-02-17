import { env } from "../config/env";

export class ApprovalService {
  isApprover(discordUserId: string): boolean {
    return discordUserId === env.APPROVER_DISCORD_USER_ID;
  }

  canMutateConfig(discordUserId: string): boolean {
    return this.isApprover(discordUserId);
  }

  canReadConfig(_discordUserId: string): boolean {
    return true;
  }
}
