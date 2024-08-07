import type { ChannelType, Snowflake } from '../../../../index';

import type { APIApplicationCommandOptionBase, APIInteractionDataOptionBase } from './base';
import type { ApplicationCommandOptionType } from './shared';

export interface APIApplicationCommandChannelOption
	extends APIApplicationCommandOptionBase<ApplicationCommandOptionType.Channel> {
	channel_types?: Exclude<ChannelType, ChannelType.DM | ChannelType.GroupDM>[];
}

export type APIApplicationCommandInteractionDataChannelOption = APIInteractionDataOptionBase<
	ApplicationCommandOptionType.Channel,
	Snowflake
>;
