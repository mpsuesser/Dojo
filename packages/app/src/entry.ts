import { Runtime } from 'foldkit'

import {
  ChangedUrl,
  ClickedLink,
  Flags,
  flags,
  init,
  managedResources,
  Message,
  Model,
  resources,
  subscriptions,
  update,
  view,
} from './main.ts'
import './styles.css'
import 'tldraw/tldraw.css'

const application = Runtime.makeApplication({
  Model,
  Flags,
  flags,
  init,
  update,
  view,
  subscriptions,
  managedResources,
  resources,
  container: document.getElementById('app'),
  routing: {
    onUrlRequest: request => ClickedLink({ request }),
    onUrlChange: url => ChangedUrl({ url }),
  },
  devTools: { Message },
})

Runtime.run(application)
