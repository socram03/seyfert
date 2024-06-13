import {
	type APIApplicationCommandInteraction,
	ApplicationCommandType,
	InteractionType,
	type APIInteraction,
	type GatewayMessageCreateDispatchData,
	InteractionContextType,
	type APIApplicationCommandInteractionDataOption,
	ApplicationCommandOptionType,
	ChannelType,
} from 'discord-api-types/v10';
import {
	Command,
	type ContextOptionsResolved,
	OptionResolver,
	type UsingClient,
	type CommandAutocompleteOption,
	type ContextMenuCommand,
	MenuCommandContext,
	BaseCommand,
	CommandContext,
	type RegisteredMiddlewares,
	SubCommand,
	IgnoreCommand,
	type CommandOption,
	type MessageCommandOptionErrors,
	type SeyfertChannelOption,
	type SeyfertIntegerOption,
	type SeyfertNumberOption,
	type SeyfertStringOption,
} from '.';
import {
	AutocompleteInteraction,
	BaseInteraction,
	type ComponentInteraction,
	type ModalSubmitInteraction,
	type ChatInputCommandInteraction,
	type MessageCommandInteraction,
	type UserCommandInteraction,
	type __InternalReplyFunction,
	Message,
	User,
} from '../structures';
import type { PermissionsBitField } from '../structures/extra/Permissions';
import { ComponentContext, ModalContext } from '../components';
import type { Client } from '../client';
import type { Awaitable, MakeRequired } from '../common';

export interface CommandFromContent {
	command?: Command | SubCommand;
	parent?: Command;
	fullCommandName: string;
}

export interface CustomResolver {}

export type HandleResolver<C = CustomResolver, D = typeof OptionResolver> = keyof C extends never ? D : C;

export class HandleCommand<HR extends HandleResolver = HandleResolver> {
	optionsResolver: HR;
	constructor(
		public client: UsingClient,
		optionsResolver?: HR,
	) {
		this.optionsResolver = (optionsResolver ?? OptionResolver) as HR;
	}

	async autocomplete(
		interaction: AutocompleteInteraction,
		optionsResolver: InstanceType<HR>,
		command?: CommandAutocompleteOption,
	) {
		// idc, is a YOU problem
		if (!command?.autocomplete) {
			return this.client.logger.warn(
				`${optionsResolver.fullCommandName} ${command?.name} command does not have 'autocomplete' callback`,
			);
		}

		try {
			try {
				try {
					await command.autocomplete(interaction);
				} catch (error) {
					if (!command.onAutocompleteError)
						return this.client.logger.error(
							`${optionsResolver.fullCommandName} ${command.name} just threw an error, ${
								error ? (typeof error === 'object' && 'message' in error ? error.message : error) : 'Unknown'
							}`,
						);
					await command.onAutocompleteError(interaction, error);
				}
			} catch (error) {
				await optionsResolver.getCommand()?.onInternalError?.(this.client, optionsResolver.getCommand()!, error);
			}
		} catch (error) {
			// pass
		}
	}

	async contextMenuMessage(
		command: ContextMenuCommand,
		interaction: MessageCommandInteraction,
		context: MenuCommandContext<MessageCommandInteraction>,
	) {
		// @ts-expect-error
		return this.contextMenuUser(command, interaction, context);
	}

	async contextMenuUser(
		command: ContextMenuCommand,
		interaction: UserCommandInteraction,
		context: MenuCommandContext<UserCommandInteraction>,
	) {
		if (command.botPermissions && interaction.appPermissions) {
			const permissions = this.checkPermissions(interaction.appPermissions, command.botPermissions);
			if (permissions) return command.onBotPermissionsFail(context, permissions);
		}

		const resultGlobal = await this.runGlobalMiddlewares(command, context);
		if (typeof resultGlobal === 'boolean') return;
		const resultMiddle = await this.runMiddlewares(command, context);
		if (typeof resultMiddle === 'boolean') return;

		try {
			try {
				await command.run!(context);
				await command.onAfterRun?.(context, undefined);
			} catch (error) {
				await command.onRunError(context, error);
				await command.onAfterRun?.(context, error);
			}
		} catch (error) {
			try {
				await command.onInternalError(this.client, error);
			} catch {
				// pass
			}
		}
	}

	async chatInput(
		command: Command | SubCommand,
		interaction: ChatInputCommandInteraction,
		resolver: InstanceType<HR>,
		context: CommandContext,
	) {
		if (command.botPermissions && interaction.appPermissions) {
			const permissions = this.checkPermissions(interaction.appPermissions, command.botPermissions);
			if (permissions) return command.onBotPermissionsFail?.(context, permissions);
		}
		if (!(await this.runOptions(command, context, resolver))) return;

		const resultGlobal = await this.runGlobalMiddlewares(command, context);
		if (typeof resultGlobal === 'boolean') return;
		const resultMiddle = await this.runMiddlewares(command, context);
		if (typeof resultMiddle === 'boolean') return;

		try {
			try {
				await command.run!(context);
				await command.onAfterRun?.(context, undefined);
			} catch (error) {
				await command.onRunError?.(context, error);
				await command.onAfterRun?.(context, error);
			}
		} catch (error) {
			try {
				await command.onInternalError?.(this.client, command, error);
			} catch {
				// pass
			}
		}
	}

	async modal(interaction: ModalSubmitInteraction) {
		const context = new ModalContext(this.client, interaction);
		const extended = this.client.options?.context?.(interaction) ?? {};
		Object.assign(context, extended);
		await this.client.components?.executeModal(context);
	}

	async messageComponent(interaction: ComponentInteraction) {
		//@ts-expect-error
		const context = new ComponentContext(this.client, interaction);
		const extended = this.client.options?.context?.(interaction) ?? {};
		Object.assign(context, extended);
		await this.client.components?.executeComponent(context);
	}

	async interaction(body: APIInteraction, shardId: number, __reply?: __InternalReplyFunction) {
		this.client.debugger?.debug(`[${InteractionType[body.type] ?? body.type}] Interaction received.`);
		switch (body.type) {
			case InteractionType.ApplicationCommandAutocomplete:
				{
					const optionsResolver = this.makeResolver(
						this.client,
						body.data.options ?? [],
						this.getCommand<Command>(body.data),
						body.guild_id,
						body.data.resolved as ContextOptionsResolved,
					);
					const interaction = new AutocompleteInteraction(this.client, body, optionsResolver, __reply);
					const command = optionsResolver.getAutocomplete();
					await this.autocomplete(interaction, optionsResolver, command);
				}
				break;
			case InteractionType.ApplicationCommand: {
				switch (body.data.type) {
					case ApplicationCommandType.Message: {
						const data = this.makeMenuCommand(body, shardId, __reply);
						if (!data) return;
						// @ts-expect-error
						this.contextMenuMessage(data.command, data.interaction, data.context);
						break;
					}
					case ApplicationCommandType.User: {
						const data = this.makeMenuCommand(body, shardId, __reply);
						if (!data) return;
						// @ts-expect-error
						this.contextMenuUser(data.command, data.interaction, data.context);
						break;
					}
					case ApplicationCommandType.ChatInput: {
						const parentCommand = this.getCommand<Command>(body.data);
						const optionsResolver = this.makeResolver(
							this.client,
							body.data.options ?? [],
							parentCommand,
							body.guild_id,
							body.data.resolved as ContextOptionsResolved,
						);
						const interaction = BaseInteraction.from(this.client, body, __reply) as ChatInputCommandInteraction;
						const command = optionsResolver.getCommand();
						if (!command?.run)
							return this.client.logger.warn(`${optionsResolver.fullCommandName} command does not have 'run' callback`);
						const context = new CommandContext(this.client, interaction, optionsResolver, shardId, command);
						const extendContext = this.client.options?.context?.(interaction) ?? {};
						Object.assign(context, extendContext);
						await this.chatInput(command, interaction, optionsResolver, context);
						break;
					}
				}
				break;
			}
			case InteractionType.ModalSubmit:
				{
					const interaction = BaseInteraction.from(this.client, body, __reply) as ModalSubmitInteraction;
					if (this.client.components?.hasModal(interaction)) {
						await this.client.components.onModalSubmit(interaction);
					} else await this.modal(interaction);
				}
				break;
			case InteractionType.MessageComponent:
				{
					const interaction = BaseInteraction.from(this.client, body, __reply) as ComponentInteraction;
					if (this.client.components?.hasComponent(body.message.id, interaction.customId)) {
						await this.client.components.onComponent(body.message.id, interaction);
					} else await this.messageComponent(interaction);
				}
				break;
		}
	}

	async message(rawMessage: GatewayMessageCreateDispatchData, shardId: number) {
		const self = this.client as unknown as Client;
		if (!self.options.commands?.defaultPrefix) return;
		const message = new Message(this.client, rawMessage);
		const prefixes = (await this.getPrefix(message)).sort((a, b) => b.length - a.length);
		const prefix = prefixes.find(x => message.content.startsWith(x));

		if (!(prefix !== undefined && message.content.startsWith(prefix))) return;

		const content = message.content.slice(prefix.length).trimStart();

		const { fullCommandName, command, parent } = this.getCommandFromContent(
			content
				.split(' ')
				.filter(x => x)
				.slice(0, 3),
		);

		if (!command) return;
		if (!command.run) return self.logger.warn(`${fullCommandName} command does not have 'run' callback`);

		if (!(command.contexts.includes(InteractionContextType.BotDM) || message.guildId)) return;
		if (!command.contexts.includes(InteractionContextType.Guild) && message.guildId) return;
		if (command.guildId && !command.guildId?.includes(message.guildId!)) return;

		const resolved: MakeRequired<ContextOptionsResolved> = {
			channels: {},
			roles: {},
			users: {},
			members: {},
			attachments: {},
		};

		let newContent = content;
		for (const i of fullCommandName.split(' ')) {
			newContent = newContent.slice(newContent.indexOf(i) + i.length);
		}

		const args = this.argsParser(newContent.slice(1), command, message);
		const { options, errors } = await this.argsOptionsParser(command, rawMessage, args, resolved);
		const optionsResolver = this.makeResolver(self, options, parent as Command, message.guildId, resolved);
		const context = new CommandContext(self, message, optionsResolver, shardId, command);
		//@ts-expect-error
		const extendContext = self.options?.context?.(message) ?? {};
		Object.assign(context, extendContext);

		try {
			if (errors.length) {
				return command.onOptionsError?.(
					context,
					Object.fromEntries(
						errors.map(x => {
							return [
								x.name,
								{
									failed: true,
									value: x.error,
									parseError: x.fullError,
								},
							];
						}),
					),
				);
			}
			if (command.defaultMemberPermissions && message.guildId) {
				const memberPermissions = await self.members.permissions(message.guildId, message.author.id);
				const permissions = this.checkPermissions(memberPermissions, command.defaultMemberPermissions);
				if (permissions && (await message.guild())!.ownerId !== message.author.id) {
					return command.onPermissionsFail?.(context, memberPermissions.keys(permissions));
				}
			}

			if (command.botPermissions && message.guildId) {
				const meMember = await self.cache.members?.get(self.botId, message.guildId);
				if (!meMember) return; //enable member cache and "Guilds" intent, lol
				const appPermissions = await meMember.fetchPermissions();
				const permissions = this.checkPermissions(appPermissions, command.botPermissions);
				if (!appPermissions.has('Administrator') && permissions) {
					return command.onBotPermissionsFail?.(context, permissions);
				}
			}

			if (!(await this.runOptions(command, context, optionsResolver))) return;

			const resultGlobal = await this.runGlobalMiddlewares(command, context);
			if (typeof resultGlobal === 'boolean') return;
			const resultMiddle = await this.runMiddlewares(command, context);
			if (typeof resultMiddle === 'boolean') return;
			try {
				await command.run!(context);
				await command.onAfterRun?.(context, undefined);
			} catch (error) {
				await command.onRunError?.(context, error);
				await command.onAfterRun?.(context, error);
			}
		} catch (error) {
			try {
				await command.onInternalError?.(this.client, command, error);
			} catch {}
		}
	}

	getPrefix(_message: Message): Awaitable<string[]> {
		return (this.client as unknown as Client).options.commands.defaultPrefix!;
	}

	argsParser(content: string, _command: SubCommand | Command, _message: Message): Record<string, string> {
		const args: Record<string, string> = {};
		for (const i of content.match(/-(.*?)(?=\s-|$)/gs) ?? []) {
			args[i.slice(1).split(' ')[0]] = i.split(' ').slice(1).join(' ');
		}
		return args;
	}

	getCommandFromContent(commandRaw: string[]): CommandFromContent {
		const rawParentName = commandRaw[0];
		const rawGroupName = commandRaw.length === 3 ? commandRaw[1] : undefined;
		const rawSubcommandName = rawGroupName ? commandRaw[2] : commandRaw[1];
		const parent = this.getMessageCommand(rawParentName);
		const fullCommandName = `${rawParentName}${
			rawGroupName ? ` ${rawGroupName} ${rawSubcommandName}` : `${rawSubcommandName ? ` ${rawSubcommandName}` : ''}`
		}`;

		if (!(parent instanceof Command)) return { fullCommandName };

		if (rawGroupName && !parent.groups?.[rawGroupName] && !parent.groupsAliases?.[rawGroupName])
			return this.getCommandFromContent([rawParentName, rawGroupName]);
		if (
			rawSubcommandName &&
			!parent.options?.some(
				x => x instanceof SubCommand && (x.name === rawSubcommandName || x.aliases?.includes(rawSubcommandName)),
			)
		)
			return this.getCommandFromContent([rawParentName]);

		const groupName = rawGroupName ? parent.groupsAliases?.[rawGroupName] || rawGroupName : undefined;

		const command =
			groupName || rawSubcommandName
				? (parent.options?.find(opt => {
						if (opt instanceof SubCommand) {
							if (groupName) {
								if (opt.group !== groupName) return false;
							}
							if (opt.group && !groupName) return false;
							return rawSubcommandName === opt.name || opt.aliases?.includes(rawSubcommandName);
						}
						return false;
					}) as SubCommand)
				: parent;

		return {
			command,
			fullCommandName,
			parent,
		};
	}
	makeResolver<T extends unknown[] = []>(...args: [...ConstructorParameters<typeof OptionResolver>, ...T]) {
		// @ts-expect-error
		return new this.optionsResolver(...args) as InstanceType<HR>;
	}

	getMessageCommand(rawParentName: string) {
		return this.client.commands!.values.find(
			x =>
				(!('ignore' in x) || x.ignore !== IgnoreCommand.Message) &&
				(x.name === rawParentName || ('aliases' in x ? x.aliases?.includes(rawParentName) : false)),
		);
	}

	getCommand<T extends Command | ContextMenuCommand>(data: {
		guild_id?: string;
		name: string;
	}): T {
		// @ts-expect-error
		return this.client.commands?.values.find(command => {
			if (data.guild_id) {
				return command.guildId?.includes(data.guild_id) && command.name === data.name;
			}
			return command.name === data.name;
		});
	}

	checkPermissions(app: PermissionsBitField, bot: bigint) {
		const permissions = app.missings(...app.values([bot]));
		if (!app.has('Administrator') && permissions.length) {
			return app.keys(permissions);
		}
		return false;
	}

	async runGlobalMiddlewares(
		command: Command | ContextMenuCommand | SubCommand,
		context: CommandContext<{}, never> | MenuCommandContext<any>,
	) {
		const resultRunGlobalMiddlewares = await BaseCommand.__runMiddlewares(
			context,
			(this.client.options?.globalMiddlewares ?? []) as keyof RegisteredMiddlewares,
			true,
		);
		if (resultRunGlobalMiddlewares.pass) {
			return true;
		}
		if ('error' in resultRunGlobalMiddlewares) {
			// @ts-expect-error
			await command.onMiddlewaresError(context, resultRunGlobalMiddlewares.error ?? 'Unknown error');
			return;
		}
		return resultRunGlobalMiddlewares;
	}

	async runMiddlewares(
		command: Command | ContextMenuCommand | SubCommand,
		context: CommandContext<{}, never> | MenuCommandContext<any>,
	) {
		const resultRunMiddlewares = await BaseCommand.__runMiddlewares(
			context,
			command.middlewares as keyof RegisteredMiddlewares,
			false,
		);
		if (resultRunMiddlewares.pass) {
			return false;
		}
		if ('error' in resultRunMiddlewares) {
			// @ts-expect-error
			await command.onMiddlewaresError(context, resultRunMiddlewares.error ?? 'Unknown error');
			return;
		}
		return resultRunMiddlewares;
	}

	makeMenuCommand(body: APIApplicationCommandInteraction, shardId: number, __reply?: __InternalReplyFunction) {
		const command = this.getCommand<ContextMenuCommand>(body.data);
		const interaction = BaseInteraction.from(this.client, body, __reply) as
			| UserCommandInteraction
			| MessageCommandInteraction;
		// idc, is a YOU problem
		if (!command?.run)
			return this.client.logger.warn(`${command.name ?? 'Unknown'} command does not have 'run' callback`);
		const context = new MenuCommandContext(this.client, interaction, shardId, command);
		const extendContext = this.client.options?.context?.(interaction) ?? {};
		Object.assign(context, extendContext);

		return { command, interaction, context };
	}

	async runOptions(command: Command | SubCommand, context: CommandContext, resolver: InstanceType<HR>) {
		const [erroredOptions, result] = await command.__runOptions(context, resolver);
		if (erroredOptions) {
			await command.onOptionsError?.(context, result);
			return false;
		}
		return true;
	}

	async argsOptionsParser(
		command: Command | SubCommand,
		message: GatewayMessageCreateDispatchData,
		args: Partial<Record<string, string>>,
		resolved: MakeRequired<ContextOptionsResolved>,
	) {
		const options: APIApplicationCommandInteractionDataOption[] = [];
		const errors: { name: string; error: string; fullError: MessageCommandOptionErrors }[] = [];
		for (const i of (command.options ?? []) as (CommandOption & { type: ApplicationCommandOptionType })[]) {
			try {
				let value: string | boolean | number | undefined;
				let indexAttachment = -1;
				switch (i.type) {
					case ApplicationCommandOptionType.Attachment:
						if (message.attachments[++indexAttachment]) {
							value = message.attachments[indexAttachment].id;
							resolved.attachments[value] = message.attachments[indexAttachment];
						}
						break;
					case ApplicationCommandOptionType.Boolean:
						if (args[i.name]) {
							value = ['yes', 'y', 'true', 'treu'].includes(args[i.name]!.toLowerCase());
						}
						break;
					case ApplicationCommandOptionType.Channel:
						{
							const rawId =
								message.content.match(/(?<=<#)[0-9]{17,19}(?=>)/g)?.find(x => args[i.name]?.includes(x)) ||
								args[i.name]?.match(/[0-9]{17,19}/g)?.[0];
							if (rawId) {
								const channel =
									(await this.client.cache.channels?.get(rawId)) ??
									(i.required ? await this.client.channels.fetch(rawId) : undefined);
								if (channel) {
									if ('channel_types' in i) {
										if (!(i as SeyfertChannelOption).channel_types!.includes(channel.type)) {
											errors.push({
												name: i.name,
												error: `The entered channel type is not one of ${(i as SeyfertChannelOption)
													.channel_types!.map(t => ChannelType[t])
													.join(', ')}`,
												fullError: ['CHANNEL_TYPES', (i as SeyfertChannelOption).channel_types!],
											});
											break;
										}
									}
									value = rawId;
									resolved.channels[rawId] = channel;
								}
							}
						}
						break;
					case ApplicationCommandOptionType.Mentionable:
						{
							const matches = message.content.match(/<@[0-9]{17,19}(?=>)|<@&[0-9]{17,19}(?=>)/g) ?? [];
							for (const match of matches) {
								if (match.includes('&')) {
									const rawId = match.slice(3);
									if (rawId) {
										const role =
											(await this.client.cache.roles?.get(rawId)) ??
											(i.required
												? (await this.client.roles.list(message.guild_id!)).find(x => x.id === rawId)
												: undefined);
										if (role) {
											value = rawId;
											resolved.roles[rawId] = role;
											break;
										}
									}
								} else {
									const rawId = match.slice(2);
									const raw = message.mentions.find(x => rawId === x.id);
									if (raw) {
										const { member, ...user } = raw;
										value = raw.id;
										resolved.users[raw.id] = user;
										if (member) resolved.members[raw.id] = member;
										break;
									}
								}
							}
						}
						break;
					case ApplicationCommandOptionType.Role:
						{
							const rawId =
								message.mention_roles.find(x => args[i.name]?.includes(x)) || args[i.name]?.match(/[0-9]{17,19}/g)?.[0];
							if (rawId) {
								const role =
									(await this.client.cache.roles?.get(rawId)) ??
									(i.required
										? (await this.client.roles.list(message.guild_id!)).find(x => x.id === rawId)
										: undefined);

								if (role) {
									value = rawId;
									resolved.roles[rawId] = role;
								}
							}
						}
						break;
					case ApplicationCommandOptionType.User:
						{
							const rawId =
								message.mentions.find(x => args[i.name]?.includes(x.id))?.id ||
								args[i.name]?.match(/[0-9]{17,19}/g)?.[0];
							if (rawId) {
								const raw =
									message.mentions.find(x => args[i.name]?.includes(x.id)) ??
									(await this.client.cache.users?.get(rawId)) ??
									(i.required ? await this.client.users.fetch(rawId) : undefined);
								if (raw) {
									value = raw.id;
									if (raw instanceof User) {
										resolved.users[raw.id] = raw;
										if (message.guild_id) {
											const member =
												message.mentions.find(x => args[i.name]?.includes(x.id))?.member ??
												(await this.client.cache.members?.get(rawId, message.guild_id)) ??
												(i.required ? await this.client.members.fetch(rawId, message.guild_id) : undefined);
											if (member) resolved.members[raw.id] = member;
										}
									} else {
										const { member, ...user } = raw;
										resolved.users[user.id] = user;
										if (member) resolved.members[user.id] = member;
									}
								}
							}
						}
						break;
					case ApplicationCommandOptionType.String:
						{
							value = args[i.name];
							const option = i as SeyfertStringOption;
							if (!value) break;
							if (option.min_length) {
								if (value.length < option.min_length) {
									value = undefined;
									errors.push({
										name: i.name,
										error: `The entered string has less than ${option.min_length} characters. The minimum required is ${option.min_length} characters.`,
										fullError: ['STRING_MIN_LENGTH', option.min_length],
									});
									break;
								}
							}
							if (option.max_length) {
								if (value.length > option.max_length) {
									value = undefined;
									errors.push({
										name: i.name,
										error: `The entered string has more than ${option.max_length} characters. The maximum required is ${option.max_length} characters.`,
										fullError: ['STRING_MAX_LENGTH', option.max_length],
									});
									break;
								}
							}
							if (option.choices?.length) {
								const choice = option.choices.find(x => x.name === value);
								if (!choice) {
									value = undefined;
									errors.push({
										name: i.name,
										error: `The entered choice is invalid. Please choose one of the following options: ${option.choices
											.map(x => x.name)
											.join(', ')}.`,
										fullError: ['STRING_INVALID_CHOICE', option.choices],
									});
									break;
								}
								value = choice.value;
							}
						}
						break;
					case ApplicationCommandOptionType.Number:
					case ApplicationCommandOptionType.Integer:
						{
							const option = i as SeyfertNumberOption | SeyfertIntegerOption;
							if (!option.choices?.length) {
								value = Number(args[i.name]);
								if (args[i.name] === undefined) {
									value = undefined;
									break;
								}
								if (Number.isNaN(value)) {
									value = undefined;
									errors.push({
										name: i.name,
										error: 'The entered choice is an invalid number.',
										fullError: ['NUMBER_NAN', args[i.name]],
									});
									break;
								}
								if (option.min_value) {
									if (value < option.min_value) {
										value = undefined;
										errors.push({
											name: i.name,
											error: `The entered number is less than ${option.min_value}. The minimum allowed is ${option.min_value}`,
											fullError: ['NUMBER_MIN_VALUE', option.min_value],
										});
										break;
									}
								}
								if (option.max_value) {
									if (value > option.max_value) {
										value = undefined;
										errors.push({
											name: i.name,
											error: `The entered number is greater than ${option.max_value}. The maximum allowed is ${option.max_value}`,
											fullError: ['NUMBER_MAX_VALUE', option.max_value],
										});
										break;
									}
								}
								break;
							}
							const choice = option.choices.find(x => x.name === args[i.name]);
							if (!choice) {
								value = undefined;
								errors.push({
									name: i.name,
									error: `The entered choice is invalid. Please choose one of the following options: ${option.choices
										.map(x => x.name)
										.join(', ')}.`,
									fullError: ['NUMBER_INVALID_CHOICE', option.choices],
								});
								break;
							}
							value = choice.value;
						}
						break;
					default:
						break;
				}
				if (value !== undefined) {
					options.push({
						name: i.name,
						type: i.type,
						value,
					} as APIApplicationCommandInteractionDataOption);
				} else if (i.required)
					if (!errors.some(x => x.name === i.name))
						errors.push({
							error: 'Option is required but returned undefined',
							name: i.name,
							fullError: ['OPTION_REQUIRED'],
						});
			} catch (e) {
				errors.push({
					error: e && typeof e === 'object' && 'message' in e ? (e.message as string) : `${e}`,
					name: i.name,
					fullError: ['UNKNOWN', e],
				});
			}
		}

		return { errors, options };
	}
}