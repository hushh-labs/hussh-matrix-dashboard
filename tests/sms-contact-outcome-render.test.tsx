import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {FeatureUserBreakdownPanel} from '../src/components/FeatureUserBreakdownPanel';
it('labels unconfirmed contact results without claiming server failure',()=>{
 const html=renderToStaticMarkup(<FeatureUserBreakdownPanel featureLabel="Emergency contact add results" totalDevices={1} totalEvents={2} successes={1} expectedErrors={0} failures={1} failureLabel="Not confirmed" measurementNote="The client could not confirm the result." eventBreakdown={[{eventName:'one_location_sms_contact_add_result',signals:2,successes:1,expectedErrors:0,failures:1}]}/>);
 expect(html).toContain('Not confirmed');expect(html).not.toContain('>Failed<');expect(html).toContain('could not confirm');
});
