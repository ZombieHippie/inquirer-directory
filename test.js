
var inquirer = require('inquirer');
var inqDir = require('./');
var path = require('path');

inquirer.registerPrompt('directory', inqDir);

inquirer.prompt([ {
  type: 'directory',
  name: 'from',
  message: 'Where would you like to put this component?',
  basePath: path.resolve('./node_modules'),
  startPath: './node_modules/deep-eql',
  filter: function (arg) {
    console.log('in filter', arg);   // put a break point here
    return arg;
  }
} ]).then(function (answers) {
  console.log('answers =>', answers);
});
