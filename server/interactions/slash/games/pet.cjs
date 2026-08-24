const {
  SlashCommandBuilder,
  EmbedBuilder,
  InteractionContextType,
  ApplicationIntegrationType,
} = require("discord.js");

const petting = require("../../../services/petting.cjs");

function getAchievementLines(achievements, userId) {
  const userAchievements = achievements.filter(
    (achievement) => achievement.userId === userId,
  );

  if (!userAchievements.length) {
    return null;
  }

  return userAchievements
    .map(
      (achievement) => `🏆 **${achievement.name}**: ${achievement.description}`,
    )
    .join("\n");
}

function buildPetEmbed(interaction, target, result) {
  const isNormalPet = result.type === "normal";
  const isReciprocatedPet = result.type === "reciprocated";
  const isCombo = result.type === "combo";

  let title = "🐾 Pet!";
  let color = 0xf472b6;
  let description = `${interaction.user} has petted ${target}!\n${target}, pet them back within one minute to start a combo.`;

  if (isReciprocatedPet) {
    title = "✨ Pet returned!";
    color = 0xa78bfa;
    description = `${interaction.user} petted ${target} back!\nA petting combo has started.`;
  }

  if (isCombo) {
    title = "✨ Petting combo!";
    color = 0xfbbf24;
    description = `${interaction.user} petted ${target} back!\nTheir petting combo is now **${result.combo.count}**.`;
  }

  const fields = [
    {
      name: "Points earned",
      value: `${interaction.user}: +${result.rewards.petterPoints}`,
      inline: true,
    },
  ];

  if (result.rewards.targetPoints > 0) {
    fields.push({
      name: "Shared points",
      value: `${target}: +${result.rewards.targetPoints}`,
      inline: true,
    });
  }

  if (result.combo?.count > 0) {
    fields.push({
      name: "Combo",
      value: [
        `Count: **${result.combo.count}**`,
        `Expires <t:${Math.floor(result.combo.expiresAt / 1000)}:R>`,
      ].join("\n"),
      inline: true,
    });
  }

  if (isNormalPet) {
    fields.push({
      name: "Pet them back",
      value: `Return the pet <t:${Math.floor(
        result.reciprocationWindowEndsAt / 1000,
      )}:R> to start a combo.`,
      inline: false,
    });
  }

  const petterAchievements = getAchievementLines(
    result.unlockedAchievements,
    interaction.user.id,
  );

  if (petterAchievements) {
    fields.push({
      name: `${interaction.user.username}'s achievement unlocked`,
      value: petterAchievements,
      inline: false,
    });
  }

  const targetAchievements = getAchievementLines(
    result.unlockedAchievements,
    target.id,
  );

  if (targetAchievements) {
    fields.push({
      name: `${target.username}'s achievement unlocked`,
      value: targetAchievements,
      inline: false,
    });
  }

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .addFields(fields)
    .setTimestamp();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("pet")
    .setDescription("Pet someone")
    .setIntegrationTypes(
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    )
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    )
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The person to pet")
        .setRequired(true),
    ),

  async execute(interaction) {
    const target = interaction.options.getUser("user", true);

    if (target.id === interaction.user.id) {
      await interaction.reply({
        content: "You cannot pet yourself.",
        ephemeral: true,
      });

      return;
    }

    if (target.bot || target.system) {
      await interaction.reply({
        content: "You can only pet real people.",
        ephemeral: true,
      });

      return;
    }

    await interaction.deferReply();

    try {
      const result = await petting.petUser({
        petterId: interaction.user.id,
        targetId: target.id,
      });

      if (!result.ok) {
        if (result.code === "SELF_PET") {
          await interaction.editReply("You cannot pet yourself.");
          return;
        }

        if (result.code === "COOLDOWN") {
          await interaction.editReply(
            `You can pet ${target} again <t:${Math.floor(
              result.cooldownUntil / 1000,
            )}:R>.`,
          );

          return;
        }

        await interaction.editReply(
          "I could not process that pet. Please try again later.",
        );

        return;
      }

      const embed = buildPetEmbed(interaction, target, result);

      await interaction.editReply({
        content: `${target}`,
        embeds: [embed],
        allowedMentions: {
          users: [target.id],
        },
      });
    } catch (error) {
      console.error(
        `[pet] Failed for ${interaction.user.id} -> ${target.id}:`,
        error,
      );

      await interaction.editReply(
        "I could not process that pet right now. Please try again later.",
      );
    }
  },
};
