import assert from 'node:assert/strict';
import {emptyDiscoverSearch,isDiscoverSearchDocument} from '../src/lib/discover-search-document';
const doc={...emptyDiscoverSearch(),query:'transit',searched:true,results:[{title:'Candidate',link:'https://example.org/paper',snippet:'A traceable abstract.'}],selected:['https://example.org/paper'],provider:'arxiv'};
assert.ok(isDiscoverSearchDocument(doc)); assert.ok(!isDiscoverSearchDocument({...doc,provider:undefined}));
assert.ok(!isDiscoverSearchDocument({...doc,results:[{...doc.results[0],link:'javascript:alert(1)'}]}));
assert.ok(isDiscoverSearchDocument(JSON.parse(JSON.stringify(doc))));
console.log('Search document roundtrip, required fields and safe source links passed');
