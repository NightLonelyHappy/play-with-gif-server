'use strict';

import chalk from 'chalk';

function success(message) {
    console.log(chalk.green(message));
}

function error(message) {
    console.log(chalk.red(message));
}

export {success, error};