import { useParams } from 'react-router-dom';
import { ShareClass } from './ShareClass';

export default function ShareClassPage() {
  const { uuid = '' } = useParams();
  return <ShareClass key={uuid} uuid={uuid} />;
}
