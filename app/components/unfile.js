
import React from 'react'

import MovieMonkey from '../core/moviemonkey.js'

const path = require('path');
const shell = require('electron').shell;

export default class UnFile extends React.Component {

  constructor(props) {
    super(props);
    this.play = this.play.bind(this);
    this.add = this.add.bind(this);
    this.addMovie = this.addMovie.bind(this);
    this.updateStatus = this.updateStatus.bind(this);

    this.state = {
      add: false,
      status: {
        mode: 0,
        message: ""
      }
    }

    this.MM = new MovieMonkey(this.props.db, this.updateStatus, this.props.userDataPath);
  }

  updateStatus(status) {
    this.setState(status);
  }

  play(e) {
    shell.openPath(this.props.data.path);
  }

  add(e) {
    this.setState({add: !this.state.add})
  }

  addMovie(e) {
    if (e.key === 'Enter') {

      let movie_file = {
        hash: this.props.data.hash,
        fileName: this.props.data.path,
        bytesize: this.props.data.bytesize
      }

      this.MM.addMovie(e.target.value, "", movie_file, this.props.onAdded);
    }
  }

  render() {
  	let unfile = this.props.data;
    let unfilepath = path.parse(unfile.path);

    return (
	      <div className={"unfile " + (this.state.add ? 'add' : '') }>
          <div className="unfile-info">
            <div className="unfile-actions">
              <div className="unfile-add" onClick={this.add}></div>
              <div className="unfile-play" onClick={this.play}></div>
            </div>
            <div className="unfile-path">
              <div className="unfile-folder">{unfilepath.dir}</div>
              <div className="unfile-name">{unfilepath.base}</div>
            </div>
          </div>
          <div className={"unfile-add-form " + (this.state.add ? '' : 'hide') }>
            <input
              id=""
              className={ (this.state.status.mode ? 'hide' : '') }
              onKeyPress={this.addMovie}
              placeholder="Type movie name and press enter"
              ref={input => input && input.focus()} />
            <div className={ (this.state.status.mode ? '' : 'hide') }>
              {this.state.status.message}
            </div>
          </div>
        </div>
    );
  }
}
