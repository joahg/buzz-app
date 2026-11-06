# Community plugins

Browse plugins that people publish in public Git repositories, see how many people added and upvoted each one, and add the ones you want.

## Getting started

1. Turn on **Community plugins** in **Settings → Plugins → Manage plugins**, then open **Community plugins** in the sidebar.
2. Search, filter by category, or sort by **All time**, **Trending**, **Hot** or **Most upvoted**. Open a plugin to read its description, its automated audit and what it can access.
3. Choose **Add to Buzz**. Buzz opens its install review for the exact indexed commit, so you can check the source and access before installing.
4. After adding a plugin from here, choose **Upvote** if you like it. You can take your upvote back at any time.

To list your own plugin, choose **Add your plugin** on the plugin list. Enter its public GitHub repository, plus a folder and branch or tag if it needs them. Buzz checks that the repository is public and has a built `manifest.json` and `plugin.js`, then sends it to the index, which lists it after its next update.

Community plugins aren't reviewed by Buzz. Only an **Official** badge marks plugins published by Block. Your Buzz's install review is always the final check.

Install counts and upvotes are anonymous: Buzz sends a random per-device identifier mixed with the plugin's ID, never your name, account or keys, and only for plugins whose repository is public. Turn off **Share anonymous install counts and upvotes** on the page to stop sending them. The page is available only in builds configured with a community plugin index.
