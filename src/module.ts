import { PanelPlugin } from '@grafana/data';
import { CorrelationPanel } from './CorrelationPanel';

export const plugin = new PanelPlugin(CorrelationPanel).setPanelOptions(builder => {
  builder
    .addNumberInput({
      path: 'windowSize',
      name: 'Correlation Window Size',
      defaultValue: 30,
      description: 'How many points used for computing rolling correlation'
    });
});
