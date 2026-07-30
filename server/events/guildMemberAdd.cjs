const JOIN_ROLE_ID = "1479193968679059647";

module.exports = {
  name: "guildMemberAdd",
  once: false,

  async execute(member) {
    if (member.user.bot) return;

    try {
      const role = member.guild.roles.cache.get(JOIN_ROLE_ID);

      if (!role) {
        console.error(
          `Join role ${JOIN_ROLE_ID} not found in guild ${member.guild.id}`,
        );
        return;
      }

      await member.roles.add(role);
      console.log(
        `Assigned join role to ${member.user.tag} in ${member.guild.name}`,
      );
    } catch (err) {
      console.error(`Failed to assign join role to ${member.user.tag}:`, err);
    }
  },
};
