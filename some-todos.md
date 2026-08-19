things to do with dojo

- interrogation UX: pick an interrogation script, enter scene (centered darkness, shadowy figure, eyes blink, greets you), engage with interrogation, engage with side buttons or other interrogation-specific hotkey buttons, finish interrogation and persist/export the data however it is needed

- `~/.dojo/plugins/{sketch,interrogation}/*.ts`: Effect-only SDK, extremely similar to OpenCode plugin loading. each scene type has its own set of params typesafely accessible by plugins. the Dojo SDK will be a published npm library

- separate CLI program for every sort of interaction with dojo (named `dojo`) - it would be what the user's agents would use to drive dojo usage in realtime while also being the entrypoint for reading out any data as necessary (it's all stored locally so just a CLI that's reading files and using IPC to bring-to-front-and-influence-the-program-state locally)

- a Mintlify docs site so that these two things (CLI, SDK) are documented and agent-accessible

- Settings UI and settings storage: OpenAI API key, Sound (Master Volume, Music Volume, Effects Volume, Speech Volume)
