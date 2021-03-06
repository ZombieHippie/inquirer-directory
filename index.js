/**
 * `directory` type prompt
 */
var rx = require('rx-lite');
var _ = require("lodash");
var util = require("util");
var chalk = require("chalk");
var figures = require("figures");
var cliCursor = require("cli-cursor");
var runAsync = require('run-async');
var Base = require("inquirer/lib/prompts/base");
var observe = require("inquirer/lib/utils/events");
var Paginator = require("inquirer/lib/utils/paginator");
var Choices = require('inquirer/lib/objects/choices');
var Separator = require('inquirer/lib/objects/separator');

var path = require('path');
var fs = require('fs');

/**
 * Module exports
 */

module.exports = Prompt;

/**
 * Constants
 */
var CHOOSE = chalk.cyan("Choose directory here");
var BACK = chalk.bold.blue("..");

/**
 * Constructor
 */

function Prompt() {
  Base.apply( this, arguments );

  if (!this.opt.basePath) {
    this.throwParamError("basePath");
  }

  if (!this.opt.cwd) {
    this.opt.cwd = process.cwd()
  }

  if (!this.opt.startPath) {
    this.opt.startPath = this.opt.basePath
  }

  this.depth = 0;
  this.currentPath = path.isAbsolute(this.opt.startPath) ? path.resolve(this.opt.startPath) : path.resolve(this.opt.cwd, this.opt.startPath);

  var relativeStartPath = path.relative(this.currentPath, this.opt.basePath);
  this.depth = (relativeStartPath.match(/\.\.[\/\\]?/g) || { length: 0 }).length;

  if (/[^\.\\\/]/.test(relativeStartPath)) {
    throw new Error('basePath must contain startPath');
  }

  this.opt.choices = new Choices(this.createChoices(this.currentPath), this.answers);
  this.selected = 0;
  if (this.depth > 0) {
    this.selected = 1;
  }

  this.firstRender = true;

  // Make sure no default is set (so it won't be printed)
  this.opt.default = null;

  this.searchTerm = '';

  this.paginator = new Paginator();

  this.paginator.paginate = function (output, active, pageSize) {
    pageSize = pageSize || 7;
    var lines = output.split('\n');

    // Make sure there's enough lines to paginate
    if (lines.length <= pageSize + 2) {
      return output;
    }

    // Move the pointer only when the user go down and limit it to 3
    if (this.pointer < 3 && this.lastIndex < active && active - this.lastIndex < 9) {
      this.pointer = Math.min(3, this.pointer + active - this.lastIndex);
    }
    this.lastIndex = active;

    // Duplicate the lines so it give an infinite list look
    var infinite = _.flatten([lines, lines, lines]);
    var topIndex = Math.max(0, active - this.pointer);

    var section = infinite.splice(topIndex, pageSize).join('\n');
    return section + '\n' + chalk.dim('(Move up and down to reveal more choices)');
  };
}
util.inherits( Prompt, Base );


/**
 * Start the Inquiry session
 * @param  {Function} cb      Callback when prompt is done
 * @return {this}
 */

Prompt.prototype._run = function( cb ) {
  var self = this;
  self.searchMode = false;
  this.done = cb;
  var alphaNumericRegex = /\w|\.|\-/i;
  var events = observe(this.rl);

  var keyUps = events.keypress.filter(function (e) {
    return e.key.name === 'up' || (!self.searchMode && e.key.name === 'k');
  }).share();

  var keyDowns = events.keypress.filter(function (e) {
    return e.key.name === 'down' || (!self.searchMode && e.key.name === 'j');
  }).share();

  var keySlash = events.keypress.filter(function (e) {
    return e.value === '/';
  }).share();

  var keyMinus = events.keypress.filter(function (e) {
    return e.value === '-';
  }).share();

  var alphaNumeric = events.keypress.filter(function (e) {
    return e.key.name === 'backspace' || alphaNumericRegex.test(e.value);
  }).share();

  var searchTerm = keySlash.flatMap(function (md) {
    self.searchMode = true;
    self.searchTerm = '';
    self.render();
    var end$ = new rx.Subject();
    var done$ = rx.Observable.merge(events.line, end$);
    return alphaNumeric.map(function (e) {
      if (e.key.name === 'backspace' && self.searchTerm.length) {
        self.searchTerm = self.searchTerm.slice(0, -1);
      } else if (e.value) {
        self.searchTerm += e.value;
      }
      if (self.searchTerm === '') {
        end$.onNext(true);
      }
      return self.searchTerm;
    })
    .takeUntil(done$)
    .doOnCompleted(function() {
      self.searchMode = false;
      self.render();
      return false;
    });
  }).share();

  var outcome = this.handleSubmit(events.line);
  outcome.drill.forEach( this.handleDrill.bind(this) );
  outcome.back.forEach( this.handleBack.bind(this) );
  keyUps.takeUntil( outcome.done ).forEach( this.onUpKey.bind(this) );
  keyDowns.takeUntil( outcome.done ).forEach( this.onDownKey.bind(this) );
  keyMinus.takeUntil( outcome.done ).forEach( this.handleBack.bind(this) );
  events.keypress.takeUntil( outcome.done ).forEach( this.hideKeyPress.bind(this) );
  searchTerm.takeUntil( outcome.done ).forEach( this.onKeyPress.bind(this) );
  outcome.done.forEach( this.onSubmit.bind(this) );

  // Init the prompt
  cliCursor.hide();
  this.render();

  return this;
};


/**
 * Render the prompt to screen
 * @return {Prompt} self
 */

Prompt.prototype.render = function() {
  // Render question
  var message = this.getQuestion();

  if ( this.firstRender ) {
    message += chalk.dim( "(Use arrow keys)" );
  }


  // Render choices or answer depending on the state
  if ( this.status === "answered" ) {
    message += chalk.cyan( path.relative(this.opt.basePath, this.currentPath) );
  } else {
    message += chalk.bold("\nDirectory: ") + (path.relative(this.opt.cwd, this.opt.basePath) || '.') + "/" + chalk.cyan(path.relative(this.opt.basePath, this.currentPath));
    var choicesStr = listRender(this.opt.choices, this.selected );
    message += "\n" + this.paginator.paginate(choicesStr, this.selected, this.opt.pageSize);
  }
  if (this.searchMode) {
    message += ("\nSearch: " + this.searchTerm);
  } else {
    message += "\n(Use \"/\" key to search this directory)";
  }

  this.firstRender = false;

  this.screen.render(message);
};


/**
 * When user press `enter` key
 */
Prompt.prototype.handleSubmit = function (e) {
  var self = this;

  var obx = e.map(function () {
    return self.opt.choices.getChoice( self.selected ).value;
  }).share();

  var done = obx.filter(function (choice) {
    return choice === CHOOSE;
  }).take(1);

  var back = obx.filter(function (choice) {
    return choice === BACK;
  }).takeUntil(done);

  var drill = obx.filter(function (choice) {
    return choice !== BACK && choice !== CHOOSE;
  }).takeUntil(done);

  return {
    done: done,
    back: back,
    drill: drill
  };
};

/**
 *  when user selects to drill into a folder (by selecting folder name)
 */
Prompt.prototype.handleDrill = function () {
  var choice = this.opt.choices.getChoice( this.selected );
  this.depth++;
  this.currentPath = path.join(this.currentPath, choice.value);
  this.opt.choices = new Choices(this.createChoices(this.currentPath), this.answers);
  this.selected = 0;
  if (this.depth > 0) {
    this.selected = 1;
  }
  this.render();
};

/**
 * when user selects ".. back"
 */
Prompt.prototype.handleBack = function () {
  if (this.depth > 0) {
    var choice = this.opt.choices.getChoice( this.selected );
    this.depth--;
    this.currentPath = path.dirname(this.currentPath);
    this.opt.choices = new Choices(this.createChoices(this.currentPath), this.answers);
    this.selected = 0;
    this.render();
  }
};

/**
 * when user selects "choose this folder"
 */
Prompt.prototype.onSubmit = function(value) {
  this.status = "answered";

  // Rerender prompt
  this.render();

  this.screen.done();
  cliCursor.show();
  this.done( path.relative(this.opt.basePath, this.currentPath) );
};


/**
 * When user press a key
 */
Prompt.prototype.hideKeyPress = function() {
  if (!this.searchMode) {
    this.render();
  }
};

Prompt.prototype.onUpKey = function() {
  var len = this.opt.choices.realLength;
  this.selected = (this.selected > 0) ? this.selected - 1 : len - 1;
  this.render();
};

Prompt.prototype.onDownKey = function() {
  var len = this.opt.choices.realLength;
  this.selected = (this.selected < len - 1) ? this.selected + 1 : 0;
  this.render();
};

Prompt.prototype.onSlashKey = function(e) {
  this.render();
};

Prompt.prototype.onKeyPress = function(e) {
  var index = findIndex.call(this, this.searchTerm);
  if (index >= 0) {
    this.selected = index;
  }
  this.render();
};

function findIndex (term) {
  var item;
  for (var i=0; i < this.opt.choices.realLength; i++) {
    item = this.opt.choices.realChoices[i].name.toLowerCase();
    if (item.indexOf(term) === 0) {
      return i;
    }
  }
  return -1;
}

/**
 * Helper to create new choices based on previous selection.
 */
Prompt.prototype.createChoices = function (basePath) {
  var fullPath = path.resolve(this.opt.cwd, basePath)
  var choices = []
  if (this.depth > 0) {
    choices.push(BACK);
  }
  choices.push(CHOOSE);
  var directoryChoices = getDirectories(fullPath);
  var files = getFiles(fullPath);
  if (files.length + directoryChoices.length > 0) {
    choices.push(new Separator());
  }
  if (directoryChoices.length > 0) {
    choices = choices.concat(directoryChoices);
  }
  if (files.length > 0) {
    choices = choices.concat(files.map(str => new Separator(str)));
  }
  if (files.length + directoryChoices.length > 0) {
    choices.push(new Separator());
  }

  return choices;
};

/**
 * Function for rendering list choices
 * @param  {Number} pointer Position of the pointer
 * @return {String}         Rendered content
 */
 function listRender(choices, pointer) {
  var output = '';
  var separatorOffset = 0;

  choices.forEach(function (choice, i) {
    if (choice.type === 'separator') {
      separatorOffset++;
      output += '  ' + choice + '\n';
      return;
    }

    var isSelected = (i - separatorOffset === pointer);
    var line = (isSelected ? figures.pointer + ' ' : '  ') + choice.name;
    if (isSelected) {
      line = chalk.cyan(line);
    }
    output += line + ' \n';
  });

  return output.replace(/\n$/, '');
}

/**
 * Function for getting list of folders in directory
 * @param  {String} basePath the path the folder to get a list of containing folders
 * @return {Array}           array of folder names inside of basePath
 */
function getDirectories(basePath) {
  return fs
    .readdirSync(basePath)
    .filter(function(file) {
      var stats = fs.lstatSync(path.join(basePath, file));
      if (stats.isSymbolicLink()) {
        return false;
      }
      var isDir = stats.isDirectory();
      var isNotDotFile = path.basename(file).indexOf('.') !== 0;
      return isDir && isNotDotFile;
    })
    .sort();
}
function getFiles(basePath) {
  return fs
    .readdirSync(basePath)
    .filter(function(file) {
      var stats = fs.lstatSync(path.join(basePath, file));
      if (stats.isSymbolicLink()) {
        return false;
      }
      var isDir = stats.isDirectory();
      var isNotDotFile = path.basename(file).indexOf('.') !== 0;
      return !isDir && isNotDotFile;
    })
    .sort();
}
