import { Runtime } from 'foldkit'

import { Model, init, update, view } from './main.ts'
import './styles.css'

const application = Runtime.makeApplication({
  Model,
  init,
  update,
  view,
  container: document.getElementById('app'),
})

Runtime.run(application)
