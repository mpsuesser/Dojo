import { Runtime } from 'foldkit'

import {
  ChangedUrl,
  ClickedLink,
  init,
  managedResources,
  Message,
  Model,
  subscriptions,
  update,
  view,
} from './main.ts'
import './styles.css'
import 'tldraw/tldraw.css'

const application = Runtime.makeApplication({
  Model,
  init,
  update,
  view,
  subscriptions,
  managedResources,
  container: document.getElementById('app'),
  routing: {
    onUrlRequest: request => ClickedLink({ request }),
    onUrlChange: url => ChangedUrl({ url }),
  },
  devTools: { Message },
})

Runtime.run(application)
