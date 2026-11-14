const { setting } = require("../config.cjs");
const JOIN_ROLE_ID = setting("JOIN_ROLE_ID");

module.exports = {
  name: "guildMemberAdd",
  once: false,

  async execute(member) {
    if (member.user.bot || !JOIN_ROLE_ID) return;

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
