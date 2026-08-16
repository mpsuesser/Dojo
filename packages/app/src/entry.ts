import { Runtime } from 'foldkit'

import {
  ChangedUrl,
  ClickedLink,
  Message,
  Model,
  init,
  update,
  view,
} from './main.ts'
import './styles.css'

const application = Runtime.makeApplication({
  Model,
  init,
  update,
  view,
  container: document.getElementById('app'),
  routing: {
    onUrlRequest: request => ClickedLink({ request }),
    onUrlChange: url => ChangedUrl({ url }),
  },
  devTools: { Message },
})

Runtime.run(application)
