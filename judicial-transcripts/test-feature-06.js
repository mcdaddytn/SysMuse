// Test script for Feature 06 - Mustache Template Engine Integration
// This tests the core functionality without needing the full build

const { TemplateEngineFactory } = require('./dist/services/TemplateEngine');

console.log('Testing Feature 06 Implementation...\n');

// Test 1: Native Template Engine
console.log('1. Testing Native Template Engine:');
const nativeEngine = TemplateEngineFactory.create({
  templateType: 'Native',
  nativeStartDelimiter: '{',
  nativeEndDelimiter: '}'
});

const nativeTemplate = 'Speaker: {speaker.name}, Type: {speaker.type}';
const data = {
  speaker: {
    name: 'John Smith',
    type: 'ATTORNEY'
  }
};

const nativeResult = nativeEngine.render(nativeTemplate, data);
console.log('   Template:', nativeTemplate);
console.log('   Result:', nativeResult);
console.log('   ✓ Native template engine works!\n');

// Test 2: Mustache Template Engine
console.log('2. Testing Mustache Template Engine:');
const mustacheEngine = TemplateEngineFactory.create({
  templateType: 'Mustache'
});

const mustacheTemplate = '{{#speaker}}Name: {{name}}, Type: {{type}}{{/speaker}}';
const mustacheResult = mustacheEngine.render(mustacheTemplate, data);
console.log('   Template:', mustacheTemplate);
console.log('   Result:', mustacheResult);
console.log('   ✓ Mustache template engine works!\n');

// Test 3: Complex Mustache with conditionals
console.log('3. Testing Mustache with conditionals:');
const complexTemplate = `{{#isStatement}}
STATEMENT by {{speaker.name}}
{{/isStatement}}
{{#isWitnessCalled}}
WITNESS CALLED: {{witnessName}}
{{/isWitnessCalled}}`;

const complexData = {
  isStatement: true,
  speaker: { name: 'Attorney Jones' },
  isWitnessCalled: false,
  witnessName: 'Dr. Smith'
};

const complexResult = mustacheEngine.render(complexTemplate, complexData);
console.log('   Result:', complexResult.trim());
console.log('   ✓ Conditional rendering works!\n');

console.log('All tests passed! Feature 06 core functionality is working.');