import { render, screen } from '@testing-library/react';
import { StatTile } from './StatTile';

describe('StatTile', () => {
  it('renders the value and label', () => {
    render(<StatTile label="WIN RATE" value="58%" />);
    expect(screen.getByText('58%')).toBeInTheDocument();
    expect(screen.getByText('WIN RATE')).toBeInTheDocument();
  });

  it('renders an em-dash when value is null', () => {
    render(<StatTile label="HANDS WON" value={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
