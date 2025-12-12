type SeriesSize = 'sm' | 'md' | 'lg';

export interface SimpleOptions {
  text: string;
  showSeriesCount: boolean;
  seriesCountSize: SeriesSize;
}

export type TemperatureUnit = 'C' | 'F';

export interface WeatherOptions {
  locationLabel: string;
  temperatureUnit: TemperatureUnit;
  showBackground: boolean;
}

export const defaults: WeatherOptions = {
  locationLabel: 'Istanbul',
  temperatureUnit: 'C',
  showBackground: true,
};
