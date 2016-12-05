
var inquirer = require('inquirer');
var inqDir = require('./');

inquirer.registerPrompt('directory', inqDir);

inquirer.prompt([ {
  type: 'directory',
  name: 'from',
  message: 'Where would you like to put this component?',
  basePath: '.',
  startPath: './node_modules',
  filter: function (arg) {
    console.log('in filter', arg);   // put a break point here
    return arg;
  }
} ]).then(function (answers) {
  console.log('answers =>', answers);
});
